package main

import "testing"

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
