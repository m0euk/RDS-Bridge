package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeIQSource is a controllable iqSource for the lane test. Start stores the
// callbacks and blocks until ctx is done; the test drives emitStream/emitIQ and
// inspects recorded Tune calls.
type fakeIQSource struct {
	controllable bool
	mu           sync.Mutex
	onStream     func(StreamInfo)
	onIQ         func([]int16)
	onFFT        func([]byte)
	ready        chan struct{}
	tunes        []uint32
}

func newFakeIQSource(controllable bool) *fakeIQSource {
	return &fakeIQSource{controllable: controllable, ready: make(chan struct{})}
}
func (f *fakeIQSource) Label() string      { return "fake" }
func (f *fakeIQSource) Controllable() bool { return f.controllable }
func (f *fakeIQSource) Close() error       { return nil }
func (f *fakeIQSource) Start(ctx context.Context, onStream func(StreamInfo), onIQ func([]int16), onFFT func([]byte)) error {
	f.mu.Lock()
	f.onStream, f.onIQ, f.onFFT = onStream, onIQ, onFFT
	f.mu.Unlock()
	close(f.ready)
	<-ctx.Done()
	return ctx.Err()
}
func (f *fakeIQSource) Tune(hz uint32) error {
	f.mu.Lock()
	f.tunes = append(f.tunes, hz)
	f.mu.Unlock()
	if !f.controllable {
		return fmt.Errorf("fake: not controllable")
	}
	// Deliberately does NOT call onStream: no real source reliably confirms a tune
	// (SpyServer sends no ClientSync in reply; rtl_tcp confirms nothing), so the hub
	// must re-announce the new centre itself. (0.8.4 cand.4)
	return nil
}
func (f *fakeIQSource) emitStream(si StreamInfo) { <-f.ready; f.onStream(si) }
func (f *fakeIQSource) emitIQ(s []int16)         { <-f.ready; f.onIQ(s) }
func (f *fakeIQSource) emitFFT(b []byte)         { <-f.ready; f.onFFT(b) }
func (f *fakeIQSource) tuneCount() int           { f.mu.Lock(); defer f.mu.Unlock(); return len(f.tunes) }

// --- minimal WebSocket client (masks client->server, reads unmasked server frames) ---

type wsClient struct {
	conn net.Conn
	br   *bufio.Reader
}

func wsDial(t *testing.T, url string) *wsClient {
	t.Helper()
	host := strings.TrimPrefix(url, "http://")
	conn, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	kb := make([]byte, 16)
	_, _ = rand.Read(kb)
	key := base64.StdEncoding.EncodeToString(kb)
	req := "GET / HTTP/1.1\r\nHost: " + host + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("write upgrade: %v", err)
	}
	br := bufio.NewReader(conn)
	// read status line + headers until blank line
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatalf("read handshake: %v", err)
		}
		if line == "\r\n" {
			break
		}
	}
	return &wsClient{conn: conn, br: br}
}

func (c *wsClient) readFrame(t *testing.T) (opcode byte, payload []byte) {
	t.Helper()
	_ = c.conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	h := make([]byte, 2)
	if _, err := io.ReadFull(c.br, h); err != nil {
		t.Fatalf("read frame header: %v", err)
	}
	opcode = h[0] & 0x0f
	n := int(h[1] & 0x7f) // server frames are unmasked
	switch n {
	case 126:
		e := make([]byte, 2)
		_, _ = io.ReadFull(c.br, e)
		n = int(binary.BigEndian.Uint16(e))
	case 127:
		e := make([]byte, 8)
		_, _ = io.ReadFull(c.br, e)
		n = int(binary.BigEndian.Uint64(e))
	}
	payload = make([]byte, n)
	_, _ = io.ReadFull(c.br, payload)
	return opcode, payload
}

func (c *wsClient) writeText(t *testing.T, s string) {
	t.Helper()
	payload := []byte(s)
	var mask [4]byte
	_, _ = rand.Read(mask[:])
	hdr := []byte{0x81} // FIN + text
	n := len(payload)
	switch {
	case n <= 125:
		hdr = append(hdr, byte(0x80|n))
	default:
		hdr = append(hdr, 0x80|126, byte(n>>8), byte(n))
	}
	hdr = append(hdr, mask[:]...)
	masked := make([]byte, n)
	for i := 0; i < n; i++ {
		masked[i] = payload[i] ^ mask[i&3]
	}
	_, _ = c.conn.Write(hdr)
	_, _ = c.conn.Write(masked)
}

func TestIQLaneEndToEnd(t *testing.T) {
	src := newFakeIQSource(true)
	iq := newIQHub(src, "rds-bridge-helper")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go iq.run(ctx, func(string) {})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, br, err := wsHandshake(w, r)
		if err != nil {
			return
		}
		iq.serveClient(conn, br)
	}))
	defer srv.Close()

	cl := wsDial(t, srv.URL)
	defer cl.conn.Close()

	// 1. hello — controllable true (fake source), protocol correct
	op, payload := cl.readFrame(t)
	if op != 0x1 {
		t.Fatalf("hello: opcode %d, want text", op)
	}
	var hello struct {
		Kind, Protocol string
		Controllable   bool
	}
	if err := json.Unmarshal(payload, &hello); err != nil {
		t.Fatalf("hello json: %v", err)
	}
	if hello.Kind != "hello" || hello.Protocol != protocolID || !hello.Controllable {
		t.Fatalf("hello wrong: %+v", hello)
	}

	// 2. stream announce (iq16, snake_case keys) — carries fft geometry
	src.emitStream(StreamInfo{SampleRate: 250000, CenterHz: 92500000, Controllable: true, Source: "fake", FFTSpanHz: 768000, FFTBins: 1024})
	op, payload = cl.readFrame(t)
	if op != 0x1 {
		t.Fatalf("stream: opcode %d, want text", op)
	}
	var raw map[string]any
	_ = json.Unmarshal(payload, &raw)
	if raw["kind"] != "stream" || raw["mode"] != "iq16" {
		t.Fatalf("stream frame wrong: %s", payload)
	}
	if raw["sample_rate"].(float64) != 250000 || raw["centre_hz"].(float64) != 92500000 {
		t.Fatalf("stream fields wrong: %s", payload)
	}
	if raw["fft_span_hz"].(float64) != 768000 || raw["fft_bins"].(float64) != 1024 {
		t.Fatalf("stream fft geometry wrong: %s", payload)
	}

	// 3. binary IQ frame — 2-byte tag [wsFrameIQ16,0] then little-endian int16 of what we sent
	src.emitIQ([]int16{1, -1, 258, -258})
	op, payload = cl.readFrame(t)
	if op != 0x2 {
		t.Fatalf("iq: opcode %d, want binary", op)
	}
	want := taggedFrame(wsFrameIQ16, iqBytesLE([]int16{1, -1, 258, -258}))
	if len(payload) != len(want) {
		t.Fatalf("iq length %d, want %d", len(payload), len(want))
	}
	for i := range want {
		if payload[i] != want[i] {
			t.Fatalf("iq byte %d = %d, want %d", i, payload[i], want[i])
		}
	}

	// 3b. binary FFT frame — 2-byte tag [wsFrameFFT8,0] then the uint8 bins verbatim
	src.emitFFT([]byte{10, 20, 30, 40})
	op, payload = cl.readFrame(t)
	if op != 0x2 {
		t.Fatalf("fft: opcode %d, want binary", op)
	}
	wantF := taggedFrame(wsFrameFFT8, []byte{10, 20, 30, 40})
	if len(payload) != len(wantF) {
		t.Fatalf("fft length %d, want %d", len(payload), len(wantF))
	}
	for i := range wantF {
		if payload[i] != wantF[i] {
			t.Fatalf("fft byte %d = %d, want %d", i, payload[i], wantF[i])
		}
	}

	// 4. tune uplink -> source.Tune called, and the HUB re-announces the new centre
	//    (the source itself confirms nothing), preserving rate + FFT geometry.
	cl.writeText(t, `{"kind":"control","action":"tune","vfo_hz":95000000}`)
	op, payload = cl.readFrame(t)
	if op != 0x1 {
		t.Fatalf("retune announce: opcode %d, want text", op)
	}
	_ = json.Unmarshal(payload, &raw)
	if raw["kind"] != "stream" || raw["centre_hz"].(float64) != 95000000 {
		t.Fatalf("retune announce wrong: %s", payload)
	}
	if raw["vfo_hz"].(float64) != 95000000 {
		t.Fatalf("retune announce vfo wrong: %s", payload)
	}
	if raw["sample_rate"].(float64) != 250000 || raw["fft_span_hz"].(float64) != 768000 || raw["fft_bins"].(float64) != 1024 {
		t.Fatalf("retune announce lost geometry: %s", payload)
	}
	if src.tuneCount() != 1 {
		t.Fatalf("tune count = %d, want 1", src.tuneCount())
	}
}

func TestIQLaneTuneRefusedWhenReadOnly(t *testing.T) {
	src := newFakeIQSource(false) // not controllable
	iq := newIQHub(src, "rds-bridge-helper")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go iq.run(ctx, func(string) {})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, br, err := wsHandshake(w, r)
		if err != nil {
			return
		}
		iq.serveClient(conn, br)
	}))
	defer srv.Close()

	cl := wsDial(t, srv.URL)
	defer cl.conn.Close()

	op, payload := cl.readFrame(t) // hello
	var hello struct{ Controllable bool }
	_ = json.Unmarshal(payload, &hello)
	if hello.Controllable {
		t.Fatalf("read-only source should report controllable:false")
	}

	src.emitStream(StreamInfo{SampleRate: 250000, CenterHz: 90200000, Controllable: false, Source: "fake"})
	_, _ = cl.readFrame(t) // stream

	// tune should be refused -> PROTOCOL §7 error frame, THEN a meta snap-back to the
	// real centre. Both: the error is the published contract, the snap-back keeps the
	// dial honest.
	cl.writeText(t, `{"kind":"control","action":"tune","vfo_hz":95000000}`)
	op, payload = cl.readFrame(t)
	if op != 0x1 {
		t.Fatalf("refusal: opcode %d, want text", op)
	}
	var e map[string]any
	_ = json.Unmarshal(payload, &e)
	if e["kind"] != "error" || e["code"] != "not-controllable" {
		t.Fatalf("expected error/not-controllable per PROTOCOL §7, got %s", payload)
	}
	op, payload = cl.readFrame(t)
	if op != 0x1 {
		t.Fatalf("snap-back: opcode %d, want text", op)
	}
	var m map[string]any
	_ = json.Unmarshal(payload, &m)
	if m["kind"] != "meta" || m["vfo_hz"].(float64) != 90200000 {
		t.Fatalf("expected meta snap-back to 90200000, got %s", payload)
	}
}
