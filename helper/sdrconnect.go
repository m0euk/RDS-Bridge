package main

// sdrconnect.go — 0.8.9 SDRConnect IQ reader.
//
// A third network-SDR iqSource alongside rtl_tcp and SpyServer, but structurally
// different from both: SDRConnect is not a raw-TCP IQ server — it exposes SDRplay's own
// published WebSocket property API (port 5454, `set_property`/`get_property`/
// `property_changed`, binary frames tagged by a 2-byte little-endian type). The helper
// is the WebSocket CLIENT here (see wsclient.go); Bridge is the proven reference for the
// exact wire shapes, and this mirrors them (index.html: send/setProp/getProp/enable).
//
// WHY THIS EXISTS: a browser reading SDRConnect directly over a WiFi LAN cannot buffer
// the real-time IQ against WiFi jitter, so audio/waterfall stutter (decode itself is
// fine — rate-agnostic). Running SDRConnect through the helper instead puts a native,
// buffered process on the jittery hop and hands Bridge a glassy localhost feed via the
// already-tested wsiq lane. The key lever is DECIMATE AT THE SOURCE (PROTOCOL §11.2):
// the helper asks SDRConnect for a narrow device_sample_rate (~250 kHz), so only ~1 MB/s
// crosses the LAN instead of the full device rate. No DSP in the helper — SDRConnect
// decimates, exactly as SpyServer's decimation stage does.
//
// Bridge, the generic protocol and both DSP workers are UNCHANGED: this source emits
// through the existing iqHub, which already conforms to PROTOCOL-generic-iq.md.

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"time"
)

// SDRConnect binary frame type prefixes (2-byte LE header, SDRCONNECT-websocket-api.md).
// Only IQ is consumed; audio (Bridge demodulates its own from the IQ) and the secondary
// device are ignored. Spectrum/FFT is a documented follow-on (see Start).
const (
	sdrcFrameAudioPCM = 1 // s16 stereo PCM @ 48 kHz — ignored (Bridge makes its own audio)
	sdrcFrameIQ       = 2 // s16 interleaved IQ (IQIQ) — the stream we relay
	sdrcFrameSpectrum = 3 // u8 spectrum FFT bins — not enabled in 0.8.9 (waterfall follow-on)
)

// sdrcTargetRate is the narrow device_sample_rate the helper requests from SDRConnect so
// the LAN carries an RDS-appropriate stream, not the full device rate. TargetIQRate
// (250 kHz) is comfortably above the ~120 kHz subcarrier floor and the 200 kHz
// weak-signal floor. Whether the RSPdxR2 honours a rate this low via the API is a bench
// question; if SDRConnect snaps to a higher rate we announce the actual readback (never
// a guess), so the wire stays honest either way.
const sdrcTargetRate = TargetIQRate

const sdrcHandshakeTimeout = 8 * time.Second

type sdrConnect struct {
	addr      string // host:port, default :5454
	initialHz uint32

	mu         sync.Mutex
	cl         *wsConn
	centerHz   uint32
	sampleRate uint32
	canControl bool
}

func newSDRConnect(addr string, initialHz uint32) *sdrConnect {
	if initialHz == 0 {
		initialHz = 98500000
	}
	return &sdrConnect{addr: addr, initialHz: initialHz, centerHz: initialHz}
}

func (s *sdrConnect) Label() string { return "SDRConnect" }

func (s *sdrConnect) Controllable() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.canControl
}

func (s *sdrConnect) Close() error {
	s.mu.Lock()
	cl := s.cl
	s.mu.Unlock()
	if cl != nil {
		return cl.close()
	}
	return nil
}

// --- SDRConnect wire helpers (mirror Bridge's send/setProp/getProp/enable) ---

type sdrcMsg struct {
	EventType string `json:"event_type"`
	Property  string `json:"property"`
	Value     string `json:"value"`
	Device    string `json:"device,omitempty"`
}

func (s *sdrConnect) send(m sdrcMsg) error {
	s.mu.Lock()
	cl := s.cl
	s.mu.Unlock()
	if cl == nil {
		return fmt.Errorf("sdrconnect: not connected")
	}
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return cl.writeText(b)
}
func (s *sdrConnect) setProp(p, v string) error {
	return s.send(sdrcMsg{EventType: "set_property", Property: p, Value: v})
}
func (s *sdrConnect) getProp(p string) error {
	return s.send(sdrcMsg{EventType: "get_property", Property: p, Value: ""})
}
func (s *sdrConnect) enable(ev string, on bool) error {
	v := "false"
	if on {
		v = "true"
	}
	return s.send(sdrcMsg{EventType: ev, Property: "", Value: v})
}

func (s *sdrConnect) Start(ctx context.Context, onStream func(StreamInfo), onIQ func([]int16), onFFT func([]byte)) error {
	_ = onFFT // 0.8.9: spectrum_enable (type-3 u8 FFT → waterfall) is a follow-on once the
	// SDRConnect FFT span/bin geometry is confirmed on the RSPdx bench. FFTSpanHz stays 0,
	// so Bridge gracefully shows no waterfall (the rtl_tcp path), decode unaffected.
	if onStream == nil || onIQ == nil {
		return fmt.Errorf("sdrconnect: nil callback")
	}
	cl, err := wsClientDial(ctx, s.addr)
	if err != nil {
		return fmt.Errorf("sdrconnect: %w", err)
	}
	s.mu.Lock()
	s.cl = cl
	s.mu.Unlock()
	defer cl.close()

	// close the socket on ctx cancel so a blocked read returns at once (prompt Stop).
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
			_ = cl.close()
		case <-stop:
		}
	}()

	// Select the (first) device and ask for the properties we need to announce. Bridge
	// sends selected_device by index string; one RSPdxR2 is index "0".
	_ = s.send(sdrcMsg{EventType: "selected_device", Value: "0"})
	for _, p := range []string{"can_control", "device_sample_rate", "device_center_frequency", "device_vfo_frequency"} {
		_ = s.getProp(p)
	}

	// Handshake gather: read property frames until we know can_control, the rate and a
	// centre. Bridge answers get_property with get_property_response; live changes arrive
	// as property_changed. Both carry {property,value} with value ALWAYS a string.
	haveRate, haveCentre, haveControl := false, false, false
	deadline := time.After(sdrcHandshakeTimeout)
	for !(haveRate && haveCentre && haveControl) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline:
			return fmt.Errorf("sdrconnect: no device properties within %s (is a device selected in SDRConnect?)", sdrcHandshakeTimeout)
		default:
		}
		op, payload, rerr := cl.readMessage()
		if rerr != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("sdrconnect: handshake read: %w", rerr)
		}
		if op != 0x1 {
			continue // binary before we've announced — ignore (stream not enabled yet)
		}
		prop, val, ok := parseSDRCProp(payload)
		if !ok {
			continue
		}
		switch prop {
		case "device_sample_rate":
			if hz, ok := parseHz(val); ok && hz > 0 {
				s.mu.Lock()
				s.sampleRate = hz
				s.mu.Unlock()
				haveRate = true
			}
		case "device_center_frequency":
			if hz, ok := parseHz(val); ok && hz > 0 {
				s.mu.Lock()
				s.centerHz = hz
				s.mu.Unlock()
				haveCentre = true
			}
		case "can_control":
			s.mu.Lock()
			s.canControl = val == "true"
			cc := s.canControl
			s.mu.Unlock()
			haveControl = true
			_ = cc
		}
	}

	s.mu.Lock()
	canControl := s.canControl
	s.mu.Unlock()

	// If we can drive the radio: narrow the device to the RDS target rate (the whole
	// point — cut LAN bytes ~10x) and centre on the wanted station, so the narrow IQ is
	// centred on it (offset 0, matching the rtl_tcp/SpyServer model). Then re-read so we
	// announce the ACTUAL applied rate/centre, never the request.
	if canControl {
		if sdrcTargetRate > 0 {
			_ = s.setProp("device_sample_rate", strconv.FormatInt(sdrcTargetRate, 10))
		}
		_ = s.setProp("device_center_frequency", strconv.FormatUint(uint64(s.initialHz), 10))
		_ = s.setProp("device_vfo_frequency", strconv.FormatUint(uint64(s.initialHz), 10))
		_ = s.getProp("device_sample_rate")
		_ = s.getProp("device_center_frequency")
		s.settle(ctx, cl, 1500*time.Millisecond)
	}

	// Enable the IQ stream (mirror Bridge: device_stream_enable then iq_stream_enable).
	if err := s.enable("device_stream_enable", true); err != nil {
		return fmt.Errorf("sdrconnect: enable device stream: %w", err)
	}
	if err := s.enable("iq_stream_enable", true); err != nil {
		return fmt.Errorf("sdrconnect: enable iq stream: %w", err)
	}

	s.mu.Lock()
	rate, center := s.sampleRate, s.centerHz
	s.mu.Unlock()
	onStream(StreamInfo{SampleRate: rate, CenterHz: center, Controllable: canControl, Source: s.Label()})
	announced := center

	// Stream loop: binary IQ → onIQ; property_changed for a genuine centre/rate change →
	// re-announce (keeps Bridge's decode offset at 0 and the readout honest). Mirrors the
	// SpyServer reader's re-announce-on-centre-change.
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		op, payload, rerr := cl.readMessage()
		if rerr != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("sdrconnect: stream read: %w", rerr)
		}
		switch op {
		case 0x2: // binary
			if len(payload) < 2 {
				continue
			}
			switch binary.LittleEndian.Uint16(payload[0:2]) {
			case sdrcFrameIQ:
				onIQ(iqInt16LE(payload[2:]))
			case sdrcFrameAudioPCM, sdrcFrameSpectrum:
				// audio: Bridge makes its own from IQ. spectrum: waterfall follow-on.
			}
		case 0x1: // text property update
			prop, val, ok := parseSDRCProp(payload)
			if !ok {
				continue
			}
			switch prop {
			case "device_center_frequency":
				if hz, ok := parseHz(val); ok && hz > 0 && hz != announced {
					announced = hz
					s.mu.Lock()
					s.centerHz = hz
					r, cc := s.sampleRate, s.canControl
					s.mu.Unlock()
					onStream(StreamInfo{SampleRate: r, CenterHz: hz, Controllable: cc, Source: s.Label()})
				}
			case "device_sample_rate":
				if hz, ok := parseHz(val); ok && hz > 0 {
					s.mu.Lock()
					s.sampleRate = hz
					c, cc := s.centerHz, s.canControl
					s.mu.Unlock()
					onStream(StreamInfo{SampleRate: hz, CenterHz: c, Controllable: cc, Source: s.Label()})
				}
			case "can_control":
				s.mu.Lock()
				s.canControl = val == "true"
				s.mu.Unlock()
			}
		}
	}
}

// settle drains property frames for up to d, applying rate/centre updates, so the
// announce that follows uses the values SDRConnect actually applied after our writes.
func (s *sdrConnect) settle(ctx context.Context, cl *wsConn, d time.Duration) {
	done := time.After(d)
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			return
		default:
		}
		_ = cl.conn.SetReadDeadline(time.Now().Add(d))
		op, payload, err := cl.readMessage()
		_ = cl.conn.SetReadDeadline(time.Time{})
		if err != nil {
			return
		}
		if op != 0x1 {
			continue // ignore any early binary
		}
		prop, val, ok := parseSDRCProp(payload)
		if !ok {
			continue
		}
		if hz, ok := parseHz(val); ok && hz > 0 {
			s.mu.Lock()
			switch prop {
			case "device_sample_rate":
				s.sampleRate = hz
			case "device_center_frequency":
				s.centerHz = hz
			}
			s.mu.Unlock()
		}
	}
}

// Tune recentres SDRConnect on the requested station: centre AND vfo together, so the
// narrow IQ stays centred on the station (offset 0). Mirrors Bridge's "centre ⌖"
// (device_center_frequency + device_vfo_frequency). Gated on can_control per §7 — the
// iqHub sends the PROTOCOL error + snap-back when this returns an error.
func (s *sdrConnect) Tune(centerHz uint32) error {
	s.mu.Lock()
	cc := s.canControl
	s.centerHz = centerHz
	s.mu.Unlock()
	if !cc {
		return fmt.Errorf("sdrconnect: can_control=false (SDRConnect reports hardware control unavailable)")
	}
	if err := s.setProp("device_center_frequency", strconv.FormatUint(uint64(centerHz), 10)); err != nil {
		return err
	}
	return s.setProp("device_vfo_frequency", strconv.FormatUint(uint64(centerHz), 10))
}

// parseSDRCProp extracts (property, value) from a property_changed / get_property_response
// text frame. Returns ok=false for any other event_type.
func parseSDRCProp(payload []byte) (prop, val string, ok bool) {
	var m sdrcMsg
	if json.Unmarshal(payload, &m) != nil {
		return "", "", false
	}
	if m.EventType != "property_changed" && m.EventType != "get_property_response" {
		return "", "", false
	}
	return m.Property, m.Value, true
}

// parseHz parses a numeric property value that SDRConnect sends as a string. Rates arrive
// as a Double (may be "250000" or "250000.0"); frequencies as a Uint64. ParseFloat covers
// both; we round to the nearest Hz.
func parseHz(s string) (uint32, bool) {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f < 0 {
		return 0, false
	}
	return uint32(f + 0.5), true
}

// iqInt16LE reads little-endian interleaved int16 IQ from the payload (after the 2-byte
// tag has been stripped). Trailing odd byte, if any, is dropped.
func iqInt16LE(b []byte) []int16 {
	n := len(b) / 2
	out := make([]int16, n)
	for i := 0; i < n; i++ {
		out[i] = int16(binary.LittleEndian.Uint16(b[i*2:]))
	}
	return out
}

// compile-time interface check.
var _ iqSource = (*sdrConnect)(nil)
