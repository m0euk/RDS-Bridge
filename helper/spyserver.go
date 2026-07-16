package main

// spyserver.go — 0.8.3 SpyServer IQ reader.
//
// The wire protocol (constants, 20-byte header, HELLO/SET_SETTING, the
// DeviceInfo+ClientSync handshake) is lifted verbatim from the Stage-1 transport
// probe's runSpyServer, which was proven against a real SpyServer feeding the
// Airspy HF+ Discovery. Two deliberate additions over the throwaway probe:
//   - it reads the actual IQ centre from ClientSync (so a read-only server announces
//     the true centre to Bridge, not a guess), and
//   - it picks the decimation stage nearest the RDS target rate rather than taking a
//     hard-coded -decim flag.
//
// Layout follows airspy's spyserver_protocol.h; all integers little-endian.

import (
	"bufio"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"
)

const (
	spyProtocolVersion = (2 << 24) | (0 << 16) | 1700 // 2.0.1700

	spyCmdHello      = 0
	spyCmdSetSetting = 2

	spySetStreamingMode    = 0
	spySetStreamingEnabled = 1
	spySetGain             = 2
	spySetIQFormat         = 100
	spySetIQFrequency      = 101
	spySetIQDecimation     = 102

	// 0.8.4 FFT settings (spyserver_protocol.h SETTING_FFT_*).
	spySetFFTFormat        = 200
	spySetFFTFrequency     = 201
	spySetFFTDecimation    = 202
	spySetFFTDBOffset      = 203
	spySetFFTDBRange       = 204
	spySetFFTDisplayPixels = 205

	spyStreamModeIQOnly = 1    // STREAM_TYPE_IQ
	spyStreamModeFFTIQ  = 0x05 // STREAM_TYPE_FFT(0x04) | STREAM_TYPE_IQ(0x01) — 0.8.4 waterfall
	spyFmtInt16         = 2    // STREAM_FORMAT_INT16 (reduced-IQ 16-bit signed I,Q)
	spyFmtUInt8         = 1    // STREAM_FORMAT_UINT8 (FFT display bins)

	spyMsgDeviceInfo = 0
	spyMsgClientSync = 1
	spyMsgInt16IQ    = 101
	spyMsgUInt8FFT   = 301 // MSG_TYPE_UINT8_FFT

	// FFT display defaults. These shape the waterfall's look, not the wire framing,
	// and are BENCH-TUNABLE against the Airspy — dB offset/range set where the floor
	// and ceiling land; DisplayPixels is the bin count. FFT decimation 0 = the full
	// device span (Airspy HF+ = 768 kHz), which is the wideband view we want.
	spyFFTBins     = 1024
	spyFFTDecim    = 0
	spyFFTDBOffset = 0
	spyFFTDBRange  = 127 // 0.8.4 cand.3: was 50 — too narrow, clipped the floor to black on the Airspy bench
)

type spyServer struct {
	addr      string
	initialHz uint32

	mu          sync.Mutex
	conn        net.Conn
	centerHz    uint32
	canControl  bool
	haveSync    bool
	pendingTune uint32 // set by Tune() before conn exists / to re-apply
	havePending bool
}

func newSpyServer(addr string, initialHz uint32) *spyServer {
	if initialHz == 0 {
		initialHz = 98500000 // a sane default; overridden by the first tune / config
	}
	return &spyServer{addr: addr, initialHz: initialHz, centerHz: initialHz}
}

func (s *spyServer) Label() string { return "SpyServer" }

func (s *spyServer) Controllable() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.canControl
}

func (s *spyServer) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn != nil {
		return s.conn.Close()
	}
	return nil
}

func (s *spyServer) Start(ctx context.Context, onStream func(StreamInfo), onIQ func([]int16), onFFT func([]byte)) error {
	if onStream == nil || onIQ == nil {
		return fmt.Errorf("spyserver: nil callback")
	}
	d := net.Dialer{Timeout: 5 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", s.addr)
	if err != nil {
		return fmt.Errorf("spyserver: dial %s: %w", s.addr, err)
	}
	s.mu.Lock()
	s.conn = conn
	s.mu.Unlock()
	defer func() { _ = conn.Close() }()

	// Close the conn on ctx cancel so a blocked Read returns at once (prompt Stop).
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-stop:
		}
	}()

	// HELLO
	name := []byte("rds-bridge-helper")
	body := make([]byte, 4+len(name))
	binary.LittleEndian.PutUint32(body[0:], spyProtocolVersion)
	copy(body[4:], name)
	if err := s.send(spyCmdHello, body); err != nil {
		return fmt.Errorf("spyserver: hello: %w", err)
	}

	br := bufio.NewReaderSize(conn, 1<<20)
	hdr := make([]byte, 20)
	readHeader := func() (mType, seq, bodySz uint32, err error) {
		if _, err = io.ReadFull(br, hdr); err != nil {
			return
		}
		mType = binary.LittleEndian.Uint32(hdr[4:])
		seq = binary.LittleEndian.Uint32(hdr[12:])
		bodySz = binary.LittleEndian.Uint32(hdr[16:])
		return
	}

	// Handshake: read until we have DeviceInfo (rate/decim) + ClientSync (control/centre).
	var maxRate uint32
	var decimStages uint32
	haveDev := false
	for !haveDev {
		mType, _, bodySz, err := readHeader()
		if err != nil {
			return fmt.Errorf("spyserver: handshake header: %w", err)
		}
		b := make([]byte, bodySz)
		if _, err := io.ReadFull(br, b); err != nil {
			return fmt.Errorf("spyserver: handshake body: %w", err)
		}
		switch mType & 0xffff {
		case spyMsgDeviceInfo:
			if len(b) >= 48 {
				u := func(i int) uint32 { return binary.LittleEndian.Uint32(b[i*4:]) }
				maxRate = u(2)
				decimStages = u(4)
			}
		case spyMsgClientSync:
			if len(b) >= 16 {
				s.mu.Lock()
				s.canControl = binary.LittleEndian.Uint32(b[0:]) != 0
				iqCenter := binary.LittleEndian.Uint32(b[3*4:]) // IQCenterFrequency
				if !s.canControl && iqCenter != 0 {
					s.centerHz = iqCenter // read-only: announce the server's real centre
				}
				s.haveSync = true
				s.mu.Unlock()
			}
			haveDev = true // sync follows device info; safe to configure now
		}
	}

	if maxRate == 0 {
		return fmt.Errorf("spyserver: no device info (maxSampleRate 0)")
	}
	decim := pickDecimation(maxRate, decimStages)
	sampleRate := maxRate >> decim
	// The wideband display FFT spans the full device rate (decim 0), independent of the
	// narrow decimated IQ used for decode. This is what Bridge paints as the waterfall.
	fftSpan := maxRate >> uint32(spyFFTDecim)

	// Configure the stream.
	set := func(t, v uint32) error {
		sb := make([]byte, 8)
		binary.LittleEndian.PutUint32(sb[0:], t)
		binary.LittleEndian.PutUint32(sb[4:], v)
		return s.send(spyCmdSetSetting, sb)
	}
	if err := set(spySetStreamingMode, spyStreamModeFFTIQ); err != nil { // 0.8.4: FFT + IQ on one connection
		return err
	}
	if err := set(spySetIQFormat, spyFmtInt16); err != nil {
		return err
	}
	if err := set(spySetIQDecimation, decim); err != nil {
		return err
	}
	// FFT display settings (uint8 bins, full-span, bench-tunable dB windowing).
	if err := set(spySetFFTFormat, spyFmtUInt8); err != nil {
		return err
	}
	if err := set(spySetFFTDisplayPixels, spyFFTBins); err != nil {
		return err
	}
	if err := set(spySetFFTDBOffset, spyFFTDBOffset); err != nil {
		return err
	}
	if err := set(spySetFFTDBRange, spyFFTDBRange); err != nil {
		return err
	}
	if err := set(spySetFFTDecimation, uint32(spyFFTDecim)); err != nil {
		return err
	}
	s.mu.Lock()
	canControl, center := s.canControl, s.centerHz
	if canControl {
		center = s.initialHz
		s.centerHz = center
	}
	s.mu.Unlock()
	if canControl {
		if err := set(spySetIQFrequency, center); err != nil {
			return err
		}
		if err := set(spySetFFTFrequency, center); err != nil { // keep the FFT centre aligned with the IQ centre
			return err
		}
	}
	if err := set(spySetStreamingEnabled, 1); err != nil {
		return err
	}

	onStream(StreamInfo{SampleRate: sampleRate, CenterHz: center, Controllable: canControl, Source: s.Label(), FFTSpanHz: fftSpan, FFTBins: spyFFTBins})

	// announced = the centre last sent to Bridge. Re-announce keys off THIS, not s.centerHz,
	// because Tune() pre-sets s.centerHz — so gating the re-announce on s.centerHz suppressed
	// it and the waterfall never followed a retune (cand.2 bench finding). (0.8.4 cand.3)
	announced := center
	var fftLogged bool

	// Stream loop. INT16_IQ messages carry the IQ; ClientSync updates may report a
	// centre change (e.g. our own tune taking effect) -> re-announce.
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		mType, _, bodySz, err := readHeader()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("spyserver: stream header: %w", err)
		}
		b := make([]byte, bodySz)
		if _, err := io.ReadFull(br, b); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("spyserver: stream body: %w", err)
		}
		switch mType & 0xffff {
		case spyMsgInt16IQ:
			n := len(b) / 2
			out := make([]int16, n)
			for i := 0; i < n; i++ {
				out[i] = int16(binary.LittleEndian.Uint16(b[i*2:]))
			}
			onIQ(out)
		case spyMsgUInt8FFT:
			if onFFT != nil && len(b) > 0 {
				onFFT(b)        // b is freshly allocated per message; the hub copies it onto the wire
				if !fftLogged { // one-shot: confirms the display FFT is flowing and usable
					fftLogged = true
					var mn, mx byte = 255, 0
					sum := 0
					for _, v := range b {
						if v < mn {
							mn = v
						}
						if v > mx {
							mx = v
						}
						sum += int(v)
					}
					log.Printf("display FFT: %d bins over %d Hz (levels min=%d max=%d mean=%d)",
						len(b), fftSpan, mn, mx, sum/len(b))
				}
			}
		case spyMsgClientSync:
			if len(b) >= 16 {
				iqCenter := binary.LittleEndian.Uint32(b[3*4:])
				if iqCenter != 0 && iqCenter != announced { // re-announce on a genuine centre change (independent of Tune's pre-set s.centerHz)
					announced = iqCenter
					s.mu.Lock()
					s.centerHz = iqCenter
					cc := s.canControl
					s.mu.Unlock()
					onStream(StreamInfo{SampleRate: sampleRate, CenterHz: iqCenter, Controllable: cc, Source: s.Label(), FFTSpanHz: fftSpan, FFTBins: spyFFTBins})
				}
			}
		}
	}
}

func (s *spyServer) Tune(centerHz uint32) error {
	s.mu.Lock()
	conn := s.conn
	cc := s.canControl
	s.centerHz = centerHz
	s.mu.Unlock()
	if !cc {
		return fmt.Errorf("spyserver: server reports CanControl=0 (not first client, or control disabled)")
	}
	if conn == nil {
		return fmt.Errorf("spyserver: not connected")
	}
	setFreq := func(setting uint32) error {
		sb := make([]byte, 8)
		binary.LittleEndian.PutUint32(sb[0:], setting)
		binary.LittleEndian.PutUint32(sb[4:], centerHz)
		return s.send(spyCmdSetSetting, sb)
	}
	if err := setFreq(spySetIQFrequency); err != nil {
		return err
	}
	return setFreq(spySetFFTFrequency) // keep the waterfall centre aligned with the tuned centre
}

func (s *spyServer) send(cmd uint32, body []byte) error {
	s.mu.Lock()
	conn := s.conn
	s.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("spyserver: not connected")
	}
	h := make([]byte, 8)
	binary.LittleEndian.PutUint32(h[0:], cmd)
	binary.LittleEndian.PutUint32(h[4:], uint32(len(body)))
	_ = conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	if _, err := conn.Write(h); err != nil {
		return err
	}
	if _, err := conn.Write(body); err != nil {
		return err
	}
	return nil
}

// pickDecimation chooses the narrowest decimation stage whose resulting rate
// (maxRate>>decim) still meets TargetIQRate. Narrower is lighter on the wire, but the
// rate caps the usable channel bandwidth, so we never round *down* through the target:
// a marginal station needs the full 200 kHz weak-signal bandwidth to commit a PI, and a
// 192 kHz stream would silently cap it. (0.8.4 cand.5 — the old "nearest to target" rule
// put the Airspy's 768 kHz on 192 kHz for the sake of a 58 kHz-closer match.)
func pickDecimation(maxRate, stages uint32) uint32 {
	best := uint32(0)
	found := false
	for d := uint32(0); d <= stages; d++ {
		if maxRate>>d < TargetIQRate {
			break // further stages only get narrower
		}
		best, found = d, true // a later stage still meeting the target is lighter on the wire
	}
	if !found {
		// Every stage is below the target (tiny device): take the widest (decim 0).
		return 0
	}
	return best
}
