package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"net"
	"sync"
	"time"
)

// rtlTCP reads IQ from an rtl_tcp server (the standard RTL-SDR network protocol,
// as served by `rtl_tcp` or SpyServer's rtl_tcp-compatible port). The device is set
// directly to TargetIQRate (a valid RTL native rate in the 225001–300000 band), so
// no decimation is needed — the stream is already narrow. Bridge therefore decodes
// on the direct path.
//
// Wire format (rtl_tcp):
//   - On connect the server sends a 12-byte dongle_info header: magic "RTL0" (4),
//     tuner_type uint32 BE (4), tuner_gain_count uint32 BE (4).
//   - Thereafter it streams raw IQ as interleaved unsigned 8-bit: I,Q,I,Q… (DC 127.5).
//   - The client sends 5-byte commands: 1 command byte + uint32 BE parameter.
type rtlTCP struct {
	addr string // host:port, e.g. "192.168.1.10:1234"

	mu       sync.Mutex
	conn     net.Conn
	centerHz uint32
}

// rtl_tcp command bytes (subset we use).
const (
	rtlSetFreq       = 0x01
	rtlSetSampleRate = 0x02
	rtlSetGainMode   = 0x03 // 0 = auto (hardware AGC-ish), 1 = manual
	rtlSetGain       = 0x04 // tenths of dB (manual mode)
	rtlSetAGCMode    = 0x08 // RTL2832 digital AGC: 0/1
)

func newRTLTCP(addr string, centerHz uint32) *rtlTCP {
	return &rtlTCP{addr: addr, centerHz: centerHz}
}

func (r *rtlTCP) Label() string      { return "rtl_tcp" }
func (r *rtlTCP) Controllable() bool { return true } // rtl_tcp always accepts set-freq

func (r *rtlTCP) Start(ctx context.Context, onStream func(StreamInfo), onIQ func([]int16), onFFT func([]byte)) error {
	_ = onFFT // rtl_tcp has no wideband display FFT (device is set narrow for direct decode); FFTSpanHz stays 0 so Bridge keeps the waterfall hidden.
	if onStream == nil || onIQ == nil {
		return fmt.Errorf("rtl_tcp: nil callback")
	}
	d := net.Dialer{Timeout: 5 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", r.addr)
	if err != nil {
		return fmt.Errorf("rtl_tcp: dial %s: %w", r.addr, err)
	}
	r.mu.Lock()
	r.conn = conn
	r.mu.Unlock()
	defer func() { _ = conn.Close() }()

	// Close the conn when ctx is cancelled so a blocked Read returns at once —
	// prompt teardown for Stop / Ctrl-C rather than waiting out the read deadline.
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-stop:
		}
	}()

	// Read and validate the 12-byte dongle header.
	hdr := make([]byte, 12)
	if err := readFull(ctx, conn, hdr); err != nil {
		return fmt.Errorf("rtl_tcp: header: %w", err)
	}
	if string(hdr[0:4]) != "RTL0" {
		return fmt.Errorf("rtl_tcp: bad magic %q (not an rtl_tcp server?)", string(hdr[0:4]))
	}

	// Configure: narrow native rate, initial centre, sensible AGC.
	if err := r.command(rtlSetSampleRate, TargetIQRate); err != nil {
		return err
	}
	if err := r.command(rtlSetFreq, r.getCenter()); err != nil {
		return err
	}
	if err := r.command(rtlSetGainMode, 0); err != nil { // auto gain: idiot-proof default
		return err
	}
	if err := r.command(rtlSetAGCMode, 1); err != nil {
		return err
	}

	onStream(StreamInfo{SampleRate: TargetIQRate, CenterHz: r.getCenter(), Controllable: true, Source: r.Label()})

	// Stream loop. Read into a byte buffer, convert u8 pairs -> int16 IQ, emit in
	// ~0.1 s blocks (an even number of int16 = whole IQ pairs).
	const blockPairs = TargetIQRate / 10 // ~100 ms
	buf := make([]byte, blockPairs*2)    // 2 bytes (I,Q) per pair
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		n, err := readSome(conn, buf)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("rtl_tcp: read: %w", err)
		}
		n -= n & 1 // whole I,Q pairs only; carry an odd trailing byte next round
		if n == 0 {
			continue
		}
		out := make([]int16, n)
		for i := 0; i < n; i++ {
			out[i] = u8LUT[buf[i]]
		}
		onIQ(out)
	}
}

func (r *rtlTCP) Tune(centerHz uint32) error {
	r.mu.Lock()
	r.centerHz = centerHz
	r.mu.Unlock()
	return r.command(rtlSetFreq, centerHz)
}

func (r *rtlTCP) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conn != nil {
		return r.conn.Close()
	}
	return nil
}

func (r *rtlTCP) getCenter() uint32 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.centerHz
}

// command sends a 5-byte rtl_tcp command (1 byte cmd + uint32 BE param).
func (r *rtlTCP) command(cmd byte, param uint32) error {
	r.mu.Lock()
	conn := r.conn
	r.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("rtl_tcp: not connected")
	}
	var msg [5]byte
	msg[0] = cmd
	binary.BigEndian.PutUint32(msg[1:], param)
	_ = conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	_, err := conn.Write(msg[:])
	if err != nil {
		return fmt.Errorf("rtl_tcp: write cmd 0x%02x: %w", cmd, err)
	}
	return nil
}

// readSome reads at least one byte (up to len(buf)), honouring a partial fill so we
// don't block waiting for a whole ~0.1 s block if the socket delivers less.
func readSome(conn net.Conn, buf []byte) (int, error) {
	return conn.Read(buf)
}

// readFull reads exactly len(buf) bytes or errors, cancellable via ctx.
func readFull(ctx context.Context, conn net.Conn, buf []byte) error {
	got := 0
	for got < len(buf) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		n, err := conn.Read(buf[got:])
		if err != nil {
			return err
		}
		got += n
	}
	return nil
}
