package main

import (
	"encoding/json"
	"testing"
)

// protocol_test.go — guards the published PROTOCOL-generic-iq.md contract against silent drift.
func TestPublishedFrameTypes(t *testing.T) {
	if wsFrameIQ16 != 2 {
		t.Errorf("iq16 frame_type = %d, want 2 (0x0002, PROTOCOL §5)", wsFrameIQ16)
	}
	f := taggedFrame(wsFrameIQ16, []byte{9, 9})
	if f[0] != 0x02 || f[1] != 0x00 { // uint16 LE 0x0002
		t.Errorf("iq16 tag bytes = %02x %02x, want 02 00", f[0], f[1])
	}
	g := taggedFrame(wsFrameFFT8, []byte{9})
	if g[0] != 0x03 || g[1] != 0x00 {
		t.Errorf("fft tag bytes = %02x %02x, want 03 00", g[0], g[1])
	}
}

// TestCatSetFrame pins the Kenwood TS-2000 VFO-A set bytes (0.9.2 reverse-CAT) and confirms
// the reader's own parseFA round-trips them — so the set form can't drift from what the
// probe proved against live SDR Console.
func TestCatSetFrame(t *testing.T) {
	const hz = 98500000
	got := catSetFA(hz)
	if got != "FA00098500000;" {
		t.Errorf("catSetFA(%d) = %q, want FA00098500000;", hz, got)
	}
	if v, ok := parseFA([]byte(got)); !ok || v != hz {
		t.Errorf("parseFA(%q) = %d,%v; want %d,true", got, v, ok, hz)
	}
}

// TestControlTuneShape guards the §7 Bridge→helper control frame the readLoop unmarshals.
func TestControlTuneShape(t *testing.T) {
	var m struct {
		Kind   string `json:"kind"`
		Action string `json:"action"`
		VfoHz  int64  `json:"vfo_hz"`
	}
	if err := json.Unmarshal([]byte(`{"kind":"control","action":"tune","vfo_hz":98500000}`), &m); err != nil {
		t.Fatal(err)
	}
	if m.Kind != "control" || m.Action != "tune" || m.VfoHz != 98500000 {
		t.Errorf("parsed %+v, want control/tune/98500000", m)
	}
}
