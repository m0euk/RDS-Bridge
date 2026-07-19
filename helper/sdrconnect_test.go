package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeSDRConnect implements just enough of SDRConnect's WebSocket property API to
// exercise the reader: it upgrades with the helper's own (tested) server-side handshake,
// answers get_property from a seeded property map, records + echoes set_property, and
// streams one binary IQ frame once iq_stream_enable arrives.
type fakeSDRConnect struct {
	mu    sync.Mutex
	props map[string]string
	sets  [][2]string // recorded (property,value) set_property calls, in order
}

func newFakeSDRConnect(props map[string]string) *fakeSDRConnect {
	return &fakeSDRConnect{props: props}
}

func (f *fakeSDRConnect) serve(w http.ResponseWriter, r *http.Request) {
	conn, br, err := wsHandshake(w, r)
	if err != nil {
		return
	}
	defer conn.Close()
	send := func(m sdrcMsg) {
		b, _ := json.Marshal(m)
		_ = wsWriteFrame(conn, 0x1, b)
	}
	for {
		op, payload, err := wsReadFrame(br)
		if err != nil {
			return
		}
		if op == 0x8 {
			return
		}
		if op != 0x1 {
			continue
		}
		var m sdrcMsg
		if json.Unmarshal(payload, &m) != nil {
			continue
		}
		switch m.EventType {
		case "get_property":
			f.mu.Lock()
			v := f.props[m.Property]
			f.mu.Unlock()
			send(sdrcMsg{EventType: "get_property_response", Property: m.Property, Value: v})
		case "set_property":
			f.mu.Lock()
			f.props[m.Property] = m.Value
			f.sets = append(f.sets, [2]string{m.Property, m.Value})
			f.mu.Unlock()
			send(sdrcMsg{EventType: "property_changed", Property: m.Property, Value: m.Value})
		case "iq_stream_enable":
			if m.Value == "true" {
				// one IQ frame: 2-byte LE type tag (2) + int16 LE samples
				payload := []int16{100, -100, 200, -200}
				b := make([]byte, 2+len(payload)*2)
				binary.LittleEndian.PutUint16(b[0:], sdrcFrameIQ)
				for i, v := range payload {
					binary.LittleEndian.PutUint16(b[2+i*2:], uint16(v))
				}
				_ = wsWriteFrame(conn, 0x2, b)
			}
		}
	}
}

func (f *fakeSDRConnect) setCalls() [][2]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([][2]string, len(f.sets))
	copy(out, f.sets)
	return out
}
func (f *fakeSDRConnect) sawSet(prop string) (string, bool) {
	for _, s := range f.setCalls() {
		if s[0] == prop {
			return s[1], true
		}
	}
	return "", false
}

func hostOf(url string) string { return strings.TrimPrefix(url, "http://") }

func TestSDRConnectControllable(t *testing.T) {
	// Device starts wide (2 MHz) at 99 MHz; controllable. The reader should narrow it to
	// the RDS target and recentre on the initial station, announcing the APPLIED values.
	fake := newFakeSDRConnect(map[string]string{
		"can_control":             "true",
		"device_sample_rate":      "2000000",
		"device_center_frequency": "99000000",
		"device_vfo_frequency":    "99000000",
	})
	srv := httptest.NewServer(http.HandlerFunc(fake.serve))
	defer srv.Close()

	src := newSDRConnect(hostOf(srv.URL), 92500000)

	var (
		gotStream StreamInfo
		streamN   int
		iq        []int16
		mu        sync.Mutex
	)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = src.Start(ctx,
			func(si StreamInfo) { mu.Lock(); gotStream = si; streamN++; mu.Unlock() },
			func(s []int16) { mu.Lock(); iq = append(iq, s...); mu.Unlock() },
			func([]byte) {},
		)
		close(done)
	}()
	time.Sleep(2500 * time.Millisecond) // handshake + 1.5s settle + stream
	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()
	if streamN < 1 {
		t.Fatalf("no stream announce")
	}
	if gotStream.SampleRate != sdrcTargetRate {
		t.Errorf("announced SampleRate = %d, want %d (narrowed at source)", gotStream.SampleRate, sdrcTargetRate)
	}
	if gotStream.CenterHz != 92500000 {
		t.Errorf("announced CenterHz = %d, want 92500000 (recentred on initial)", gotStream.CenterHz)
	}
	if !gotStream.Controllable || gotStream.Source != "SDRConnect" {
		t.Errorf("controllable/source wrong: %+v", gotStream)
	}
	// int16 LE conversion, verbatim
	want := []int16{100, -100, 200, -200}
	if len(iq) != len(want) {
		t.Fatalf("iq len = %d, want %d", len(iq), len(want))
	}
	for i := range want {
		if iq[i] != want[i] {
			t.Errorf("iq[%d] = %d, want %d", i, iq[i], want[i])
		}
	}
	// the source must have requested the narrow rate and recentred (centre + vfo)
	if v, ok := fake.sawSet("device_sample_rate"); !ok || v != "250000" {
		t.Errorf("device_sample_rate set = %q,%v, want 250000", v, ok)
	}
	if v, ok := fake.sawSet("device_center_frequency"); !ok || v != "92500000" {
		t.Errorf("device_center_frequency set = %q,%v, want 92500000", v, ok)
	}
	if v, ok := fake.sawSet("device_vfo_frequency"); !ok || v != "92500000" {
		t.Errorf("device_vfo_frequency set = %q,%v, want 92500000", v, ok)
	}
}

func TestSDRConnectTuneRecentres(t *testing.T) {
	fake := newFakeSDRConnect(map[string]string{
		"can_control":             "true",
		"device_sample_rate":      "250000",
		"device_center_frequency": "92500000",
		"device_vfo_frequency":    "92500000",
	})
	srv := httptest.NewServer(http.HandlerFunc(fake.serve))
	defer srv.Close()
	src := newSDRConnect(hostOf(srv.URL), 92500000)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { _ = src.Start(ctx, func(StreamInfo) {}, func([]int16) {}, func([]byte) {}); close(done) }()
	time.Sleep(2200 * time.Millisecond)

	if err := src.Tune(95000000); err != nil {
		t.Fatalf("Tune: %v", err)
	}
	time.Sleep(150 * time.Millisecond)
	cancel()
	<-done

	// Tune recentres: the LAST centre AND vfo writes are both the tune target (95 MHz),
	// offset-0 model. (Earlier writes are the initial recentre during Start.)
	var lastCentre, lastVfo string
	for _, s := range fake.setCalls() {
		switch s[0] {
		case "device_center_frequency":
			lastCentre = s[1]
		case "device_vfo_frequency":
			lastVfo = s[1]
		}
	}
	if lastCentre != "95000000" {
		t.Errorf("tune centre last set = %q, want 95000000", lastCentre)
	}
	if lastVfo != "95000000" {
		t.Errorf("tune vfo last set = %q, want 95000000", lastVfo)
	}
}

func TestSDRConnectReadOnly(t *testing.T) {
	// can_control=false: announce the server's real centre, never set rate/centre, refuse Tune.
	fake := newFakeSDRConnect(map[string]string{
		"can_control":             "false",
		"device_sample_rate":      "2000000",
		"device_center_frequency": "90200000",
		"device_vfo_frequency":    "90200000",
	})
	srv := httptest.NewServer(http.HandlerFunc(fake.serve))
	defer srv.Close()
	src := newSDRConnect(hostOf(srv.URL), 92500000)

	var gotStream StreamInfo
	var mu sync.Mutex
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = src.Start(ctx, func(si StreamInfo) { mu.Lock(); gotStream = si; mu.Unlock() }, func([]int16) {}, func([]byte) {})
		close(done)
	}()
	time.Sleep(800 * time.Millisecond) // no controllable settle on this path

	if err := src.Tune(95000000); err == nil {
		t.Errorf("expected Tune to error on read-only server")
	}
	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()
	if gotStream.CenterHz != 90200000 {
		t.Errorf("CenterHz = %d, want 90200000 (server's real centre)", gotStream.CenterHz)
	}
	if gotStream.Controllable {
		t.Errorf("expected not controllable")
	}
	// a read-only reader must not have tried to set rate or frequency
	if _, ok := fake.sawSet("device_sample_rate"); ok {
		t.Errorf("read-only reader set device_sample_rate")
	}
	if _, ok := fake.sawSet("device_center_frequency"); ok {
		t.Errorf("read-only reader set device_center_frequency")
	}
}
