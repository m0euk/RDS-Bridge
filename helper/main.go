package main

// rds-bridge-helper — 0.8.0 meta lane.
//
// Reads an SDR application's tuned frequency (rigctld, TCP) and serves it to RDS
// Bridge over the clean-room rds-bridge-iq/1 protocol in meta mode. Bridge connects
// to this helper as a WebSocket client; the helper is the server. One-way by default
// (controllable:false) — the helper never controls the SDR.
//
// The frames emitted here follow the rds-bridge-iq/1 protocol (meta mode);
// see PROTOCOL-generic-iq.md for the specification.
//
// Zero external dependencies: pure standard library, single static binary.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const (
	protocolID = "rds-bridge-iq/1"
	stationHz  = 50000 // a move this large is a genuine station change (matches Bridge)
)

// helperBuild identifies the build in the startup log and -version, so a captured test
// log always names the exact build. Pre-sign-off it carries a candidate id; set it to the
// release version (e.g. "0.8.1-beta") at sign-off.
var helperBuild = "0.8.6-beta"

// ---- frames (JSON shapes per PROTOCOL-generic-iq.md) ----

type helloFrame struct {
	Kind         string `json:"kind"`
	Protocol     string `json:"protocol"`
	Source       string `json:"source"`
	Live         bool   `json:"live"`
	Controllable bool   `json:"controllable"`
}
type streamFrame struct {
	Kind  string `json:"kind"`
	Mode  string `json:"mode"`
	VfoHz int64  `json:"vfo_hz"`
}
type vfoFrame struct {
	Kind  string `json:"kind"`
	VfoHz int64  `json:"vfo_hz"`
}
type errorFrame struct {
	Kind string `json:"kind"`
	Code string `json:"code"`
}

// ---- frequency sources ----

type freqSource interface {
	read() (int64, error)
	label() string
	close() // release any held handle (serial port / TCP conn) on swap or shutdown
}

// rigctld: persistent TCP client, sends "f\n", parses the frequency line, reconnects on error.
type rigctldSource struct {
	addr string
	conn net.Conn
	br   *bufio.Reader
}

func (s *rigctldSource) label() string { return "rigctld " + s.addr }
func (s *rigctldSource) close()        { s.reset() }
func (s *rigctldSource) reset() {
	if s.conn != nil {
		s.conn.Close()
		s.conn = nil
		s.br = nil
	}
}
func (s *rigctldSource) read() (int64, error) {
	if s.conn == nil {
		c, err := net.DialTimeout("tcp", s.addr, 2*time.Second)
		if err != nil {
			return 0, err
		}
		s.conn = c
		s.br = bufio.NewReader(c)
	}
	_ = s.conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := s.conn.Write([]byte("f\n")); err != nil {
		s.reset()
		return 0, err
	}
	line, err := s.br.ReadString('\n')
	if err != nil {
		s.reset()
		return 0, err
	}
	line = strings.TrimSpace(line)
	if strings.HasPrefix(line, "RPRT") {
		return 0, fmt.Errorf("rigctld returned %s", line)
	}
	hz, err := strconv.ParseInt(line, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("unparseable frequency %q", line)
	}
	return hz, nil
}

// mock: scripted frequency for testing without a radio (mirrors the stub's scenario).
type mockSource struct{ start time.Time }

func (m *mockSource) label() string { return "mock (scripted)" }
func (m *mockSource) close()        {}
func (m *mockSource) read() (int64, error) {
	switch el := time.Since(m.start); {
	case el < 4*time.Second:
		return 98500000, nil
	case el < 8*time.Second:
		return 104300000, nil
	case el < 12*time.Second:
		return 104320000, nil // 20 kHz jitter — Bridge should ignore
	default:
		return 91200000, nil
	}
}

// ---- clients + hub ----

type client struct {
	conn     net.Conn
	mu       sync.Mutex // guards socket writes
	streamed atomic.Bool
}

func (c *client) send(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return wsWriteFrame(c.conn, 0x1, b)
}

type hub struct {
	mu      sync.Mutex
	clients map[*client]bool
	cur     int64
	last    int64
	have    bool
	source  string

	srcMu   sync.Mutex // guards src/cfg/lastErr (live reconfigure from the config page)
	src     freqSource
	cfg     Config
	lastErr string

	// 0.8.3: when the helper runs the wsiq (IQ) lane instead of the meta lane, iqMode
	// is true and iqStatus (if set) supplies the config-page status from the iqHub.
	iqMode   bool
	iqStatus func() (label string, freqHz int64, streaming bool, clients int)
}

func newHub(source string) *hub {
	return &hub{clients: make(map[*client]bool), source: source}
}
func (h *hub) add(c *client)    { h.mu.Lock(); h.clients[c] = true; h.mu.Unlock() }
func (h *hub) remove(c *client) { h.mu.Lock(); delete(h.clients, c); h.mu.Unlock(); c.conn.Close() }

// setSource swaps the live frequency source (from the config page), closing the old one so
// a re-selected serial port is released before it is re-opened. The poll loop picks up the
// new source on its next tick.
func (h *hub) setSource(s freqSource, cfg Config) {
	h.srcMu.Lock()
	old := h.src
	h.src = s
	h.cfg = cfg
	h.lastErr = ""
	h.srcMu.Unlock()
	if old != nil && old != s {
		old.close()
	}
}
func (h *hub) currentSource() freqSource { h.srcMu.Lock(); defer h.srcMu.Unlock(); return h.src }
func (h *hub) setErr(e string)           { h.srcMu.Lock(); h.lastErr = e; h.srcMu.Unlock() }

// statusSnapshot gathers everything the config page's /status endpoint reports.
func (h *hub) statusSnapshot() statusView {
	h.srcMu.Lock()
	cfg, lastErr := h.cfg, h.lastErr
	var label string
	if h.src != nil {
		label = h.src.label()
	}
	h.srcMu.Unlock()

	h.mu.Lock()
	cur, have, n := h.cur, h.have, len(h.clients)
	h.mu.Unlock()

	// In IQ mode the frequency/label/count come from the iqHub, not the meta poll loop.
	if h.iqStatus != nil {
		if l, f, streaming, clients := h.iqStatus(); true {
			label, cur, have, n = l, f, streaming, clients
		}
	}

	return statusView{
		Build:           helperBuild,
		LocalIP:         localIPv4(),
		SourceType:      cfg.Source,
		SourceLabel:     label,
		HaveFreq:        have,
		FreqHz:          cur,
		BridgeConnected: n > 0,
		BridgeCount:     n,
		LastError:       lastErr,
		Config:          cfg,
	}
}

func abs64(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

// tick records a fresh reading and pushes it to every client.
func (h *hub) tick(vfo int64) {
	h.mu.Lock()
	changed := !h.have || abs64(vfo-h.last) >= stationHz
	h.cur = vfo
	h.have = true
	if changed {
		h.last = vfo
	}
	cs := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		cs = append(cs, c)
	}
	h.mu.Unlock()

	for _, c := range cs {
		if c.streamed.CompareAndSwap(false, true) {
			_ = c.send(streamFrame{Kind: "stream", Mode: "meta", VfoHz: vfo})
			continue
		}
		if changed {
			_ = c.send(vfoFrame{Kind: "tune", VfoHz: vfo})
		}
		_ = c.send(vfoFrame{Kind: "meta", VfoHz: vfo})
	}
}

func (h *hub) onConnect(c *client, controllable bool) {
	_ = c.send(helloFrame{Kind: "hello", Protocol: protocolID, Source: h.source, Live: true, Controllable: controllable})
	h.mu.Lock()
	have, cur := h.have, h.cur
	h.mu.Unlock()
	if have && c.streamed.CompareAndSwap(false, true) {
		_ = c.send(streamFrame{Kind: "stream", Mode: "meta", VfoHz: cur})
	}
}

// per-client read loop: handle close/ping, and refuse control frames.
func (c *client) readLoop(br *bufio.Reader, h *hub) {
	defer h.remove(c)
	for {
		op, payload, err := wsReadFrame(br)
		if err != nil {
			return
		}
		switch op {
		case 0x8: // close
			return
		case 0x9: // ping → pong
			c.mu.Lock()
			_ = wsWriteFrame(c.conn, 0xA, payload)
			c.mu.Unlock()
		case 0x1: // text
			var m struct {
				Kind string `json:"kind"`
			}
			if json.Unmarshal(payload, &m) == nil && m.Kind == "control" {
				_ = c.send(errorFrame{Kind: "error", Code: "not-controllable"})
			}
		}
	}
}

func main() {
	var (
		rigAddr    = flag.String("rigctld", "", "rigctld TCP address to poll (advanced; overrides the saved source for this run)")
		listen     = flag.String("listen", "", "WebSocket + config-page address (default 127.0.0.1:8765)")
		pollEvery  = flag.Duration("poll", 0, "frequency poll interval (advanced)")
		mock       = flag.Bool("mock", false, "use a scripted frequency source instead of a radio (no radio needed)")
		serialPort = flag.String("serial", "", "serial/CAT port to read (e.g. COM12) — Kenwood TS-2000 CAT for SDR Console")
		serialBaud = flag.Int("baud", 0, "serial/CAT baud rate (match your SDR software's CAT setting)")
		rtltcpAddr = flag.String("rtltcp", "", "rtl_tcp IQ source host:port (network-SDR mode, e.g. 192.168.1.10:1234)")
		spyAddr    = flag.String("spyserver", "", "SpyServer IQ source host:port (network-SDR mode, e.g. 192.168.1.10:5555)")
		iqFreq     = flag.Int64("iqfreq", 0, "initial IQ centre frequency in Hz (network-SDR mode)")
		srcName    = flag.String("source", "", "source name reported in hello (advanced)")
		openMode   = flag.String("open", "always", "open the config page in a browser at startup: always | never | firstrun")
		showVer    = flag.Bool("version", false, "print version and exit")
	)
	flag.Parse()

	if *showVer {
		fmt.Println("rds-bridge-helper " + helperBuild)
		return
	}

	// The saved config file is the source of truth once created (the config page writes it);
	// explicitly-set flags override it for this run only, so advanced/CLI use still works.
	cfg, hadFile := loadConfig()
	flag.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "serial":
			cfg.Source, cfg.SerialPort = "serial", *serialPort
		case "baud":
			cfg.Baud = *serialBaud
		case "mock":
			if *mock {
				cfg.Source = "mock"
			}
		case "rigctld":
			cfg.Source, cfg.Rigctld = "rigctld", *rigAddr
		case "rtltcp":
			cfg.Source, cfg.IQServer = "rtltcp", *rtltcpAddr
		case "spyserver":
			cfg.Source, cfg.IQServer = "spyserver", *spyAddr
		case "iqfreq":
			cfg.IQFreqHz = *iqFreq
		case "listen":
			cfg.Listen = *listen
		case "poll":
			cfg.PollMs = int(pollEvery.Milliseconds())
		case "source":
			cfg.SourceName = *srcName
		}
	})

	h := newHub(cfg.SourceName)
	h.iqMode = cfg.isIQSource()

	var iq *iqHub
	if h.iqMode {
		// 0.8.3 wsiq lane: stream narrow IQ from rtl_tcp / SpyServer. The meta poll loop
		// is skipped; the iqHub drives everything and supplies the config-page status.
		h.setSource(nil, cfg) // keep cfg populated for /status; no freqSource in this lane
		src, err := cfg.buildIQSource()
		if err != nil {
			log.Fatalf("IQ source: %v", err) // config guarantees a valid IQ source here
		}
		iq = newIQHub(src, cfg.SourceName)
		h.iqStatus = iq.status
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		go iq.run(ctx, h.setErr)
	} else {
		// Meta lane (unchanged). A not-yet-valid source (e.g. serial with no port picked)
		// is NON-fatal — the config page lets the user set it up live, no terminal needed.
		if src, err := cfg.buildSource(); err != nil {
			log.Printf("source not ready: %v (set it up in the config page)", err)
			h.setSource(nil, cfg)
		} else {
			h.setSource(src, cfg)
		}
	}

	// Poll loop — always reads whatever source is currently configured, so a live swap from
	// the config page takes effect on the next tick.
	go func() {
		if h.iqMode {
			return // IQ lane has no frequency poll loop; the iqHub streams instead
		}
		t := time.NewTicker(cfg.pollInterval())
		defer t.Stop()
		var warned bool
		var lastLabel string
		for range t.C {
			src := h.currentSource()
			if src == nil {
				continue
			}
			if src.label() != lastLabel { // source was swapped — reset the warn latch
				lastLabel = src.label()
				warned = false
			}
			hz, err := src.read()
			if err != nil {
				h.setErr(err.Error())
				if !warned {
					log.Printf("source (%s) unavailable: %v (will keep retrying)", src.label(), err)
					warned = true
				}
				continue
			}
			if warned {
				log.Printf("source (%s) recovered", src.label())
				warned = false
			}
			h.setErr("")
			h.tick(hz)
		}
	}()

	// One port serves both roles: a WebSocket upgrade is the Bridge protocol; a plain browser
	// GET gets the config page. Bridge's ws://<host>:8765 is unchanged.
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if isWebSocketUpgrade(r) {
			conn, br, err := wsHandshake(w, r)
			if err != nil {
				return
			}
			log.Printf("Bridge connected from %s", conn.RemoteAddr())
			if h.iqMode {
				iq.serveClient(conn, br) // wsiq lane: stream IQ + accept tune
			} else {
				c := &client{conn: conn}
				h.add(c)
				h.onConnect(c, false) // meta lane: one-way, controllable:false
				go c.readLoop(br, h)
			}
			return
		}
		serveConfigPage(w, r)
	})
	http.HandleFunc("/status", h.handleStatus)
	http.HandleFunc("/ports", handlePorts)
	http.HandleFunc("/config", h.handleConfig)
	http.HandleFunc("/quit", handleQuit)

	url := browseURL(cfg.Listen)

	// Pre-flight the port. If it's already in use, the helper is almost certainly already
	// running — so instead of dying with a bind error (invisible once the console is hidden in
	// packaging), just open the running instance's page and exit cleanly. Double-clicking the
	// file again therefore always shows the page, whether or not one was already running.
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		if errors.Is(err, syscall.EADDRINUSE) {
			log.Printf("rds-bridge-helper is already running on %s — opening its page.", cfg.Listen)
			if *openMode != "never" {
				openBrowser(url)
			}
			return
		}
		log.Fatalf("cannot listen on %s: %v", cfg.Listen, err)
	}

	// We own the port, so this is the primary instance — now safe to open (and truncate) the
	// log file. The already-running path returns above, before this point, so a second launch
	// never clobbers the running instance's log. On a -H=windowsgui build this file is the only
	// place the startup/status log survives (there is no console).
	setupLogging()

	openIt := *openMode == "always" || (*openMode == "firstrun" && !hadFile)
	if openIt {
		go func() { time.Sleep(400 * time.Millisecond); openBrowser(url) }()
	}

	lbl := "none — open the page to set one up"
	if s := h.currentSource(); s != nil {
		lbl = s.label()
	}
	log.Printf("rds-bridge-helper %s ready.", helperBuild)
	log.Printf("  Config page:  %s   (open this in a browser to set things up)", url)
	log.Printf("  Bridge URL:   ws://%s   (enter this in RDS Bridge)", hostForBridge(cfg.Listen))
	log.Printf("  Source:       %s", lbl)
	log.Fatal(http.Serve(ln, nil))
}
