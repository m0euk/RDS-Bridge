package main

// iqsource.go — 0.8.3 network-SDR IQ sources (rtl_tcp, SpyServer).
//
// The 0.8.0–0.8.2 helper is a *frequency sidecar*: a freqSource is polled and its
// frequency pushed to Bridge over the meta lane. 0.8.3 adds a second, parallel lane:
// an iqSource STREAMS narrow IQ to Bridge's wsiq client, which decodes it directly.
//
// The two lanes never run at once — the config picks one source — so the meta lane
// (serial/rigctld/mock + hub.tick) is left byte-for-byte unchanged and the IQ lane
// lives alongside it (see iqlane.go). An iqSource is a push/streaming model, the
// opposite of freqSource's poll model, so it is a distinct interface rather than a
// bolt-on.

import "context"

// iqSource streams narrow, RDS-appropriate IQ and (when the hardware allows) accepts
// a tune. Delivered pre-decimated to ~TargetIQRate so Bridge decodes on its validated
// direct path (dcEngaged=false) and the wire stays ~12x lighter than full rate.
type iqSource interface {
	// Start opens the source and streams until ctx is cancelled or a fatal error
	// occurs. onStream fires first (initial announce) and again after each honoured
	// retune, carrying the actual centre so Bridge's decode offset returns to 0.
	// onIQ fires for each block of interleaved int16 IQ (I,Q,I,Q…). onFFT fires for
	// each block of uint8 display-FFT bins (0.8.4 waterfall) — sources without a
	// wideband FFT (e.g. rtl_tcp) simply never call it and announce FFTSpanHz=0.
	// Start blocks.
	Start(ctx context.Context, onStream func(StreamInfo), onIQ func([]int16), onFFT func([]byte)) error
	// Tune requests a hardware centre change (Hz); safe to call concurrently with
	// Start. Errors (without retuning) when the source cannot control the radio.
	Tune(centerHz uint32) error
	// Controllable reports whether Tune can succeed.
	Controllable() bool
	// Label is the human name shown in Bridge's status line and the config page.
	Label() string
	// Close releases the device/connection.
	Close() error
}

// StreamInfo is the parameter set announced to Bridge (maps to the iq16 "stream"
// frame: sample_rate, center_hz, vfo_hz, live). 0.8.4 adds the wideband display-FFT
// geometry: FFTSpanHz is the total width the FFT bins cover (centred on CenterHz) and
// FFTBins is the bin count. Both are 0 for sources with no wideband FFT (rtl_tcp),
// which is Bridge's signal to keep the waterfall hidden (graceful degrade).
type StreamInfo struct {
	SampleRate   uint32
	CenterHz     uint32
	Controllable bool
	Source       string
	FFTSpanHz    uint32
	FFTBins      uint32
}

// TargetIQRate is the helper's preferred narrow output rate: comfortably above the
// ~120 kHz floor (below which the 57 kHz RDS subcarrier clips) and inside the
// RTL-SDR native 225001–300000 Hz band, so rtl_tcp needs no decimation. SpyServer
// picks the decimation stage whose rate is closest to (and not below) this.
const TargetIQRate = 250000

// iqBytesLE encodes interleaved int16 IQ as little-endian bytes for the wire. All
// helper targets are little-endian, but we encode explicitly so the payload is
// correct regardless of host byte order and the intent is unmistakable.
func iqBytesLE(s []int16) []byte {
	b := make([]byte, len(s)*2)
	for i, v := range s {
		u := uint16(v)
		b[i*2] = byte(u)
		b[i*2+1] = byte(u >> 8)
	}
	return b
}

// u8LUT maps an rtl_tcp unsigned-8-bit sample to a symmetric int16 (DC at 127.5 -> 0),
// built once so the hot path is a table lookup with no per-sample float math.
var u8LUT [256]int16

func init() {
	for u := 0; u < 256; u++ {
		u8LUT[u] = int16((float64(u) - 127.5) / 127.5 * 32767.0)
	}
}

// compile-time interface checks.
var (
	_ iqSource = (*rtlTCP)(nil)
	_ iqSource = (*spyServer)(nil)
)
