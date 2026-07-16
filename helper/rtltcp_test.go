package main

import (
	"context"
	"encoding/binary"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// fakeRTLServer stands in for rtl_tcp: sends the 12-byte RTL0 header, records the
// 5-byte commands the client sends, then streams a burst of known u8 IQ so we can
// check the u8->int16 conversion end-to-end.
type fakeRTLServer struct {
	ln       net.Listener
	mu       sync.Mutex
	commands [][5]byte
	iqBytes  []byte // u8 payload to stream after the header
}

func startFakeRTL(t *testing.T, iqBytes []byte) *fakeRTLServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := &fakeRTLServer{ln: ln, iqBytes: iqBytes}
	go s.serve()
	return s
}

func (s *fakeRTLServer) addr() string { return s.ln.Addr().String() }

func (s *fakeRTLServer) serve() {
	conn, err := s.ln.Accept()
	if err != nil {
		return
	}
	defer conn.Close()

	// header: "RTL0" + tuner_type(BE) + gain_count(BE)
	hdr := make([]byte, 12)
	copy(hdr[0:4], "RTL0")
	binary.BigEndian.PutUint32(hdr[4:8], 5) // e.g. R820T
	binary.BigEndian.PutUint32(hdr[8:12], 29)
	_, _ = conn.Write(hdr)

	// stream the IQ payload
	_, _ = conn.Write(s.iqBytes)

	// read commands until the client disconnects
	cmd := make([]byte, 5)
	for {
		if _, err := io.ReadFull(conn, cmd); err != nil {
			return
		}
		var c [5]byte
		copy(c[:], cmd)
		s.mu.Lock()
		s.commands = append(s.commands, c)
		s.mu.Unlock()
	}
}

func (s *fakeRTLServer) cmds() [][5]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([][5]byte, len(s.commands))
	copy(out, s.commands)
	return out
}

func TestRTLTCPHandshakeAndConvert(t *testing.T) {
	// Known u8 payload: 128 -> ~0, 0 -> min, 255 -> max, 127.5 DC.
	payload := []byte{128, 128, 0, 255, 255, 0, 64, 192}
	s := startFakeRTL(t, payload)
	defer s.ln.Close()

	r := newRTLTCP(s.addr(), 98800000) // 98.8 MHz

	var (
		gotStream StreamInfo
		gotIQ     []int16
		mu        sync.Mutex
		streamN   int
	)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = r.Start(ctx,
			func(si StreamInfo) { mu.Lock(); gotStream = si; streamN++; mu.Unlock() },
			func(iq []int16) { mu.Lock(); gotIQ = append(gotIQ, iq...); mu.Unlock() },
			func([]byte) {},
		)
		close(done)
	}()

	// let the header + payload flow
	time.Sleep(200 * time.Millisecond)
	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()

	// stream announce
	if streamN < 1 {
		t.Fatalf("no stream announce")
	}
	if gotStream.SampleRate != TargetIQRate {
		t.Errorf("SampleRate = %d, want %d", gotStream.SampleRate, TargetIQRate)
	}
	if gotStream.CenterHz != 98800000 {
		t.Errorf("CenterHz = %d, want 98800000", gotStream.CenterHz)
	}
	if !gotStream.Controllable || gotStream.Source != "rtl_tcp" {
		t.Errorf("controllable/source wrong: %+v", gotStream)
	}

	// conversion: 8 bytes -> 4 IQ int16 pairs = 8 int16
	if len(gotIQ) != len(payload) {
		t.Fatalf("got %d int16, want %d", len(gotIQ), len(payload))
	}
	// 128 -> near 0
	if gotIQ[0] < -300 || gotIQ[0] > 300 {
		t.Errorf("u8 128 -> %d, expected near 0", gotIQ[0])
	}
	// 0 -> near -full-scale, 255 -> near +full-scale
	if gotIQ[2] > -32000 {
		t.Errorf("u8 0 -> %d, expected near -32768", gotIQ[2])
	}
	if gotIQ[3] < 32000 {
		t.Errorf("u8 255 -> %d, expected near +32767", gotIQ[3])
	}
	// symmetry: 64 and 192 are equidistant from 127.5 -> roughly opposite signs
	if gotIQ[6] > 0 || gotIQ[7] < 0 {
		t.Errorf("64/192 signs wrong: %d %d", gotIQ[6], gotIQ[7])
	}

	// commands: sample-rate first, then set-freq to 98.8 MHz, then gain-mode, AGC
	cmds := s.cmds()
	if len(cmds) < 4 {
		t.Fatalf("got %d commands, want >=4: %v", len(cmds), cmds)
	}
	findCmd := func(b byte) (uint32, bool) {
		for _, c := range cmds {
			if c[0] == b {
				return binary.BigEndian.Uint32(c[1:]), true
			}
		}
		return 0, false
	}
	if sr, ok := findCmd(rtlSetSampleRate); !ok || sr != TargetIQRate {
		t.Errorf("set-sample-rate cmd = %d,%v want %d", sr, ok, TargetIQRate)
	}
	if f, ok := findCmd(rtlSetFreq); !ok || f != 98800000 {
		t.Errorf("set-freq cmd = %d,%v want 98800000", f, ok)
	}
}

func TestRTLTCPTune(t *testing.T) {
	s := startFakeRTL(t, make([]byte, 64))
	defer s.ln.Close()
	r := newRTLTCP(s.addr(), 98800000)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { _ = r.Start(ctx, func(StreamInfo) {}, func([]int16) {}, func([]byte) {}); close(done) }()
	time.Sleep(100 * time.Millisecond)

	if err := r.Tune(95000000); err != nil { // 95.0 MHz
		t.Fatalf("Tune: %v", err)
	}
	time.Sleep(100 * time.Millisecond)
	cancel()
	<-done

	// a set-freq to 95.0 MHz must appear among the commands
	found := false
	for _, c := range s.cmds() {
		if c[0] == rtlSetFreq && binary.BigEndian.Uint32(c[1:]) == 95000000 {
			found = true
		}
	}
	if !found {
		t.Errorf("Tune did not send set-freq 95000000; cmds=%v", s.cmds())
	}
}

func TestRTLTCPBadMagic(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		_, _ = c.Write([]byte("XXXX00000000")) // wrong magic
		time.Sleep(50 * time.Millisecond)
		c.Close()
	}()
	r := newRTLTCP(ln.Addr().String(), 98800000)
	err := r.Start(context.Background(), func(StreamInfo) {}, func([]int16) {}, func([]byte) {})
	if err == nil {
		t.Fatal("expected error on bad magic")
	}
}
