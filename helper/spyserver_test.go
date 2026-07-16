package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// fakeSpyServer implements just enough of the SpyServer protocol to exercise the
// reader: it replies to HELLO with DeviceInfo + ClientSync, records SET_SETTING
// commands, then streams one INT16_IQ message.
type fakeSpyServer struct {
	ln         net.Listener
	canControl uint32
	iqCenter   uint32
	maxRate    uint32
	decimStgs  uint32

	mu       sync.Mutex
	settings map[uint32]uint32
}

func startFakeSpy(t *testing.T, canControl, iqCenter, maxRate, decimStgs uint32) *fakeSpyServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := &fakeSpyServer{ln: ln, canControl: canControl, iqCenter: iqCenter, maxRate: maxRate, decimStgs: decimStgs, settings: map[uint32]uint32{}}
	go s.serve()
	return s
}

func (s *fakeSpyServer) addr() string { return s.ln.Addr().String() }

func (s *fakeSpyServer) writeMsg(conn net.Conn, msgType uint32, body []byte) {
	h := make([]byte, 20)
	binary.LittleEndian.PutUint32(h[4:], msgType)
	binary.LittleEndian.PutUint32(h[16:], uint32(len(body)))
	_, _ = conn.Write(h)
	_, _ = conn.Write(body)
}

func (s *fakeSpyServer) serve() {
	conn, err := s.ln.Accept()
	if err != nil {
		return
	}
	defer conn.Close()
	br := bufio.NewReader(conn)

	// read HELLO
	if !s.readCmd(br) {
		return
	}
	// DeviceInfo: needs >=48 bytes; u(2)=maxRate, u(4)=decimStages
	dev := make([]byte, 48)
	binary.LittleEndian.PutUint32(dev[2*4:], s.maxRate)
	binary.LittleEndian.PutUint32(dev[4*4:], s.decimStgs)
	s.writeMsg(conn, spyMsgDeviceInfo, dev)
	// ClientSync: u(0)=CanControl, u(3)=IQCenterFrequency
	sync := make([]byte, 28)
	binary.LittleEndian.PutUint32(sync[0:], s.canControl)
	binary.LittleEndian.PutUint32(sync[3*4:], s.iqCenter)
	s.writeMsg(conn, spyMsgClientSync, sync)

	// read the SET_SETTING commands the client sends until streamingEnabled
	for {
		if !s.readCmd(br) {
			return
		}
		s.mu.Lock()
		enabled := s.settings[spySetStreamingEnabled]
		s.mu.Unlock()
		if enabled == 1 {
			break
		}
	}

	// stream one INT16 IQ message: 4 IQ pairs
	iq := make([]byte, 16)
	for i := 0; i < 4; i++ {
		binary.LittleEndian.PutUint16(iq[i*4:], uint16(int16(1000+i)))
		binary.LittleEndian.PutUint16(iq[i*4+2:], uint16(int16(-1000-i)))
	}
	s.writeMsg(conn, spyMsgInt16IQ, iq)

	// stream one UInt8 FFT message: 4 display bins (0.8.4 waterfall path)
	s.writeMsg(conn, spyMsgUInt8FFT, []byte{5, 15, 25, 35})

	// keep reading (e.g. a Tune SET_SETTING) until the client disconnects
	for s.readCmd(br) {
	}
}

// readCmd reads one client command (8-byte header + body) and records SET_SETTINGs.
func (s *fakeSpyServer) readCmd(br *bufio.Reader) bool {
	h := make([]byte, 8)
	if _, err := io.ReadFull(br, h); err != nil {
		return false
	}
	cmd := binary.LittleEndian.Uint32(h[0:])
	sz := binary.LittleEndian.Uint32(h[4:])
	body := make([]byte, sz)
	if _, err := io.ReadFull(br, body); err != nil {
		return false
	}
	if cmd == spyCmdSetSetting && sz >= 8 {
		t := binary.LittleEndian.Uint32(body[0:])
		v := binary.LittleEndian.Uint32(body[4:])
		s.mu.Lock()
		s.settings[t] = v
		s.mu.Unlock()
	}
	return true
}

func (s *fakeSpyServer) setting(t uint32) (uint32, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.settings[t]
	return v, ok
}

func TestSpyServerHandshakeControllable(t *testing.T) {
	// maxRate 2.4 MHz, 8 decim stages. pickDecimation should choose the narrowest stage still meeting
	// the 250 kHz target: 2.4e6>>3 = 300k (>=250k) vs >>4 = 150k (below) -> decim 3, rate 300000.
	s := startFakeSpy(t, 1, 0, 2400000, 8)
	defer s.ln.Close()
	sp := newSpyServer(s.addr(), 92500000)

	var (
		gotStream StreamInfo
		iqTotal   int
		fftBytes  []byte
		mu        sync.Mutex
	)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = sp.Start(ctx,
			func(si StreamInfo) { mu.Lock(); gotStream = si; mu.Unlock() },
			func(iq []int16) { mu.Lock(); iqTotal += len(iq); mu.Unlock() },
			func(f []byte) { mu.Lock(); fftBytes = append(fftBytes, f...); mu.Unlock() },
		)
		close(done)
	}()
	time.Sleep(250 * time.Millisecond)
	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()
	if gotStream.SampleRate != 300000 {
		t.Errorf("SampleRate = %d, want 300000 (2.4M>>3)", gotStream.SampleRate)
	}
	if gotStream.CenterHz != 92500000 {
		t.Errorf("CenterHz = %d, want 92500000 (controllable -> initial freq)", gotStream.CenterHz)
	}
	if !gotStream.Controllable {
		t.Errorf("expected controllable")
	}
	if gotStream.FFTSpanHz != 2400000 { // full device rate (fft decim 0)
		t.Errorf("FFTSpanHz = %d, want 2400000", gotStream.FFTSpanHz)
	}
	if gotStream.FFTBins != spyFFTBins {
		t.Errorf("FFTBins = %d, want %d", gotStream.FFTBins, spyFFTBins)
	}
	if iqTotal != 8 { // 4 IQ pairs = 8 int16
		t.Errorf("iqTotal = %d, want 8", iqTotal)
	}
	if len(fftBytes) != 4 { // the fake server streams one 4-bin UInt8 FFT message
		t.Errorf("fft bytes = %d, want 4", len(fftBytes))
	}
	// settings the client must have sent
	if v, ok := s.setting(spySetStreamingMode); !ok || v != spyStreamModeFFTIQ {
		t.Errorf("streaming mode = %d,%v, want FFT_IQ(0x05)", v, ok)
	}
	if v, ok := s.setting(spySetIQFormat); !ok || v != spyFmtInt16 {
		t.Errorf("iq format = %d,%v", v, ok)
	}
	if v, ok := s.setting(spySetIQDecimation); !ok || v != 3 {
		t.Errorf("decimation = %d,%v, want 3", v, ok)
	}
	if v, ok := s.setting(spySetIQFrequency); !ok || v != 92500000 {
		t.Errorf("iq frequency = %d,%v, want 92500000", v, ok)
	}
	if v, ok := s.setting(spySetFFTFormat); !ok || v != spyFmtUInt8 {
		t.Errorf("fft format = %d,%v, want UInt8", v, ok)
	}
	if v, ok := s.setting(spySetFFTDisplayPixels); !ok || v != spyFFTBins {
		t.Errorf("fft display pixels = %d,%v, want %d", v, ok, spyFFTBins)
	}
	if v, ok := s.setting(spySetFFTFrequency); !ok || v != 92500000 {
		t.Errorf("fft frequency = %d,%v, want 92500000", v, ok)
	}
}

func TestSpyServerReadOnlyUsesServerCentre(t *testing.T) {
	// CanControl=0, server centre 90.2 MHz. Reader must announce that centre and refuse Tune.
	s := startFakeSpy(t, 0, 90200000, 2400000, 8)
	defer s.ln.Close()
	sp := newSpyServer(s.addr(), 92500000)

	var gotStream StreamInfo
	var mu sync.Mutex
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = sp.Start(ctx, func(si StreamInfo) { mu.Lock(); gotStream = si; mu.Unlock() }, func([]int16) {}, func([]byte) {})
		close(done)
	}()
	time.Sleep(250 * time.Millisecond)

	if err := sp.Tune(95000000); err == nil {
		t.Errorf("expected Tune to error on read-only server")
	}
	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()
	if gotStream.CenterHz != 90200000 {
		t.Errorf("CenterHz = %d, want 90200000 (server's IQ centre)", gotStream.CenterHz)
	}
	if gotStream.Controllable {
		t.Errorf("expected not controllable")
	}
	// the client must NOT have sent a frequency setting when it can't control
	if _, ok := s.setting(spySetIQFrequency); ok {
		t.Errorf("read-only client should not set frequency")
	}
}

func TestPickDecimation(t *testing.T) {
	cases := []struct {
		maxRate, stages, want uint32
	}{
		{2400000, 8, 3}, // 300k: narrowest stage still >= 250k (>>4 = 150k is below)
		{250000, 0, 0},  // already at target
		{768000, 4, 1},  // 384k: >>2 = 192k would cap the 200 kHz weak-signal bandwidth
		{100000, 4, 0},  // every stage below target -> widest
	}
	for _, c := range cases {
		if got := pickDecimation(c.maxRate, c.stages); got != c.want {
			t.Errorf("pickDecimation(%d,%d) = %d, want %d", c.maxRate, c.stages, got, c.want)
		}
	}
}
