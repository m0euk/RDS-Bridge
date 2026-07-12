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
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	protocolID = "rds-bridge-iq/1"
	stationHz  = 50000 // a move this large is a genuine station change (matches Bridge)
)

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
}

// rigctld: persistent TCP client, sends "f\n", parses the frequency line, reconnects on error.
type rigctldSource struct {
	addr string
	conn net.Conn
	br   *bufio.Reader
}

func (s *rigctldSource) label() string { return "rigctld " + s.addr }
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
}

func newHub(source string) *hub {
	return &hub{clients: make(map[*client]bool), source: source}
}
func (h *hub) add(c *client)    { h.mu.Lock(); h.clients[c] = true; h.mu.Unlock() }
func (h *hub) remove(c *client) { h.mu.Lock(); delete(h.clients, c); h.mu.Unlock(); c.conn.Close() }

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
		rigAddr    = flag.String("rigctld", "localhost:4532", "rigctld TCP address to poll")
		listen     = flag.String("listen", ":8765", "WebSocket address for Bridge to connect to")
		pollEvery  = flag.Duration("poll", 500*time.Millisecond, "frequency poll interval")
		mock       = flag.Bool("mock", false, "use a scripted frequency source instead of rigctld (no radio needed)")
		serialPort = flag.String("serial", "", "serial/CAT port (0.8.1 — not implemented)")
		srcName    = flag.String("source", "rds-bridge-helper", "source name reported in hello")
	)
	flag.Parse()

	if *serialPort != "" {
		if _, err := newSerialSource(*serialPort); err != nil {
			log.Fatalf("%v", err)
		}
	}

	var src freqSource
	if *mock {
		src = &mockSource{start: time.Now()}
	} else {
		src = &rigctldSource{addr: *rigAddr}
	}

	h := newHub(*srcName)

	// poll loop
	go func() {
		t := time.NewTicker(*pollEvery)
		defer t.Stop()
		var warned bool
		for range t.C {
			hz, err := src.read()
			if err != nil {
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
			h.tick(hz)
		}
	}()

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		conn, br, err := wsHandshake(w, r)
		if err != nil {
			return
		}
		c := &client{conn: conn}
		h.add(c)
		log.Printf("Bridge connected from %s", conn.RemoteAddr())
		h.onConnect(c, false) // one-way: controllable:false
		go c.readLoop(br, h)
	})

	log.Printf("rds-bridge-helper: serving %s on ws://%s  (source: %s, poll %s)", protocolID, *listen, src.label(), *pollEvery)
	log.Fatal(http.ListenAndServe(*listen, nil))
}
