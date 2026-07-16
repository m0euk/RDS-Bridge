package main

// iqlane.go — 0.8.3 wsiq lane.
//
// The parallel to the meta hub for IQ sources. Where the meta hub polls a freqSource
// and pushes frequency frames, the iqHub runs a streaming iqSource and pushes:
//   - a JSON "stream" announce (mode:iq16, sample_rate, center_hz, vfo_hz) on start
//     and after each retune, and
//   - binary WebSocket frames of interleaved int16 IQ.
// It handles a "tune" uplink from Bridge (Bridge is the controller here, unlike the
// one-way meta lane) by retuning the source; the source's fresh announce follows.
//
// Reuses the existing client type and the ws.go framing (wsWriteFrame already takes an
// opcode, so binary is opcode 0x2 with no change to the tested WebSocket code).

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"net"
	"sync"
	"time"
)

// iqStreamFrame is the iq16 "stream" announce (snake_case keys matching Bridge's wsiq
// client). Reuses helloFrame (main.go) for the hello — same shape.
type iqStreamFrame struct {
	Kind         string `json:"kind"`
	Mode         string `json:"mode"`
	SampleRate   int64  `json:"sample_rate"`
	CentreHz     int64  `json:"centre_hz"` // spelling per PROTOCOL-generic-iq.md §4.2 (published contract)
	VfoHz        int64  `json:"vfo_hz"`
	Controllable bool   `json:"controllable"`
	Live         bool   `json:"live"`
	FFTSpanHz    int64  `json:"fft_span_hz,omitempty"` // 0.8.4: wideband waterfall width (0/omitted = no waterfall)
	FFTBins      int64  `json:"fft_bins,omitempty"`
}

// wsiq tagged-binary frame kinds. These are the published PROTOCOL-generic-iq.md §5
// frame_type values (uint16 LE in bytes 0..1), NOT ad-hoc numbers: iq16 is 0x0002 per
// the spec, and the uint8 display FFT takes a free value, additive per §8. (0.8.4
// cand.6 — cand.2 shipped iq16 as 0x0001, which would have silently dropped every
// spec-conformant third-party source.)
const (
	wsFrameIQ16 = 2 // 0x0002: interleaved int16 LE IQ (PROTOCOL §5.1)
	wsFrameFFT8 = 3 // 0x0003: uint8 display-FFT bins (PROTOCOL §5.3, added 0.8.4)
)

// sendBinary writes an unmasked binary (opcode 0x2) frame under the client's write lock.
func (c *client) sendBinary(b []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return wsWriteFrame(c.conn, 0x2, b)
}

type iqHub struct {
	source  iqSource
	srcName string // reported in hello (cfg.SourceName)

	mu         sync.Mutex
	clients    map[*client]bool
	haveStream bool
	last       iqStreamFrame
	// status for the config page
	centerHz     int64
	streaming    bool
	controllable bool
}

func newIQHub(source iqSource, srcName string) *iqHub {
	return &iqHub{source: source, srcName: srcName, clients: make(map[*client]bool)}
}

func (q *iqHub) add(c *client)    { q.mu.Lock(); q.clients[c] = true; q.mu.Unlock() }
func (q *iqHub) remove(c *client) { q.mu.Lock(); delete(q.clients, c); q.mu.Unlock(); c.conn.Close() }

// status reports the config-page view: source label, current centre, whether IQ is
// flowing, and how many Bridges are connected.
func (q *iqHub) status() (label string, freqHz int64, streaming bool, clients int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.source.Label(), q.centerHz, q.streaming, len(q.clients)
}

// onConnect greets a newly connected Bridge: hello, then the current stream announce
// if we are already streaming (so a late joiner starts decoding immediately).
func (q *iqHub) onConnect(c *client) {
	q.mu.Lock()
	have := q.haveStream
	last := q.last
	q.mu.Unlock()
	ctrl := q.source.Controllable() // live capability (rtl_tcp: always; SpyServer: post-sync)
	_ = c.send(helloFrame{Kind: "hello", Protocol: protocolID, Source: q.srcName, Live: true, Controllable: ctrl})
	if have && c.streamed.CompareAndSwap(false, true) {
		_ = c.send(last)
	}
}

// broadcastStream stores and sends a stream announce to every client (initial + retune).
func (q *iqHub) broadcastStream(si StreamInfo) {
	f := iqStreamFrame{
		Kind: "stream", Mode: "iq16",
		SampleRate: int64(si.SampleRate), CentreHz: int64(si.CenterHz), VfoHz: int64(si.CenterHz),
		Controllable: si.Controllable, Live: true,
		FFTSpanHz: int64(si.FFTSpanHz), FFTBins: int64(si.FFTBins),
	}
	q.mu.Lock()
	q.last = f
	q.haveStream = true
	q.streaming = true
	q.centerHz = int64(si.CenterHz)
	q.controllable = si.Controllable
	cs := make([]*client, 0, len(q.clients))
	for c := range q.clients {
		cs = append(cs, c)
	}
	q.mu.Unlock()
	for _, c := range cs {
		c.streamed.Store(true) // a re-announce resets the "streamed" gate for late joiners
		_ = c.send(f)
	}
}

// broadcastIQ encodes int16 IQ as little-endian bytes, prepends the 2-byte IQ tag, and
// sends a binary frame to all.
func (q *iqHub) broadcastIQ(samples []int16) {
	cs := q.snapshotClients()
	if cs == nil {
		return // no consumers; drop rather than buffer (live stream)
	}
	frame := taggedFrame(wsFrameIQ16, iqBytesLE(samples))
	for _, c := range cs {
		_ = c.sendBinary(frame)
	}
}

// broadcastFFT sends a block of uint8 display-FFT bins to all clients, tagged as an FFT
// frame (0.8.4 waterfall). Display bins are cheap, so unlike IQ we don't gate on client
// count differently — same drop-if-none behaviour.
func (q *iqHub) broadcastFFT(bins []byte) {
	cs := q.snapshotClients()
	if cs == nil {
		return
	}
	frame := taggedFrame(wsFrameFFT8, bins)
	for _, c := range cs {
		_ = c.sendBinary(frame)
	}
}

// snapshotClients returns a copy of the current client set, or nil if there are none.
func (q *iqHub) snapshotClients() []*client {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.clients) == 0 {
		return nil
	}
	cs := make([]*client, 0, len(q.clients))
	for c := range q.clients {
		cs = append(cs, c)
	}
	return cs
}

// taggedFrame builds a wsiq binary frame: 2-byte header [kind, 0] followed by payload.
func taggedFrame(kind byte, payload []byte) []byte {
	frame := make([]byte, 2+len(payload))
	frame[0] = kind
	copy(frame[2:], payload)
	return frame
}

// readLoop handles one Bridge's uplink: tune requests, close, ping. Bridge is the
// controller on this lane (the meta lane is one-way; wsiq is two-way by design).
func (q *iqHub) readLoop(c *client, br *bufio.Reader) {
	defer q.remove(c)
	for {
		op, payload, err := wsReadFrame(br)
		if err != nil {
			return
		}
		switch op {
		case 0x8: // close
			return
		case 0x9: // ping -> pong
			c.mu.Lock()
			_ = wsWriteFrame(c.conn, 0xA, payload)
			c.mu.Unlock()
		case 0x1: // text control
			var m struct {
				Kind   string `json:"kind"`
				Action string `json:"action"`
				VfoHz  int64  `json:"vfo_hz"`
			}
			if json.Unmarshal(payload, &m) != nil {
				continue
			}
			// Bridge→source control per PROTOCOL-generic-iq.md §7. (0.8.4 cand.6 — cand.2
			// used a bare {"kind":"tune"}, which both diverged from the published contract
			// and collided with §4.3's source→Bridge "tune" (same key, opposite direction).)
			if m.Kind == "control" && m.Action == "tune" && m.VfoHz > 0 {
				if err := q.source.Tune(uint32(m.VfoHz)); err != nil {
					// Refusal, per PROTOCOL-generic-iq.md §7: reply error/not-controllable.
					// The meta lane has always done this; the wsiq lane sent only the
					// snap-back below, so it diverged from the published contract on the
					// refusal path (found by diffing the code against the spec before the
					// lane's first publish — the same check that caught the frame-type and
					// centre_hz drift in 0.8.4).
					_ = c.send(errorFrame{Kind: "error", Code: "not-controllable"})
					// Then snap Bridge's readout back to the real centre (§4.4 meta). This is
					// additive, not a substitute: echoing a bogus VFO is a traced failure mode,
					// and the error frame alone would leave the dial showing a tune that never
					// happened.
					q.mu.Lock()
					cur := q.centerHz
					q.mu.Unlock()
					_ = c.send(vfoFrame{Kind: "meta", VfoHz: cur})
					continue
				}
				// Re-announce the new centre ourselves. (0.8.4 cand.4) cand.2/3 assumed the
				// source would announce after a retune, but SpyServer sends no ClientSync in
				// reply to SET_IQ_FREQUENCY and rtl_tcp confirms nothing at all — so Bridge
				// was left on the pre-tune centre: the waterfall never followed, and the
				// decode offset was silently wrong (it only decoded on the bench because the
				// 11.5 MHz error happened to be an exact multiple of the 250 kHz rate, which
				// aliases to zero). The tune returned no error, so the centre is the request;
				// if a source does later confirm asynchronously, its own announce corrects us.
				q.reannounce(uint32(m.VfoHz))
			}
		}
	}
}

// reannounce re-sends the stream announce with a new centre, keeping every other
// parameter from the last announce (rate/FFT geometry don't change on a retune). Used
// after a successful tune, because no supported source reliably confirms one.
func (q *iqHub) reannounce(centerHz uint32) {
	q.mu.Lock()
	last, have := q.last, q.haveStream
	q.mu.Unlock()
	if !have {
		return // nothing announced yet; the initial announce will carry the centre
	}
	q.broadcastStream(StreamInfo{
		SampleRate:   uint32(last.SampleRate),
		CenterHz:     centerHz,
		Controllable: last.Controllable,
		Source:       q.source.Label(),
		FFTSpanHz:    uint32(last.FFTSpanHz),
		FFTBins:      uint32(last.FFTBins),
	})
}

// run drives the source with reconnect-retry, exactly like the meta poll loop's
// resilience: a dropped SDR/connection is retried rather than fatal, so the helper
// keeps serving the config page and recovers when the source returns.
func (q *iqHub) run(ctx context.Context, setErr func(string)) {
	var warned bool
	for {
		if ctx.Err() != nil {
			return
		}
		err := q.source.Start(ctx, q.broadcastStream, q.broadcastIQ, q.broadcastFFT)
		if ctx.Err() != nil {
			return
		}
		q.mu.Lock()
		q.streaming = false
		q.mu.Unlock()
		if err != nil {
			setErr(err.Error())
			if !warned {
				log.Printf("IQ source (%s) unavailable: %v (will keep retrying)", q.source.Label(), err)
				warned = true
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second): // backoff before reconnect
		}
	}
}

// isWSClient is a tiny helper so main.go's handler can register an IQ client and start
// its loops without importing bufio/net there.
func (q *iqHub) serveClient(conn net.Conn, br *bufio.Reader) {
	c := &client{conn: conn}
	q.add(c)
	q.onConnect(c)
	go q.readLoop(c, br)
}
