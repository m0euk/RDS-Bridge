package main

// Minimal server-side WebSocket (RFC 6455) using only the Go standard library,
// so the helper ships as a single static binary with no external modules.
// Text frames only (plus ping/pong/close) — all this protocol needs.

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// wsHandshake upgrades an HTTP request to a WebSocket connection and hijacks it.
func wsHandshake(w http.ResponseWriter, r *http.Request) (net.Conn, *bufio.Reader, error) {
	if !strings.Contains(strings.ToLower(r.Header.Get("Upgrade")), "websocket") {
		http.Error(w, "expected websocket upgrade", http.StatusBadRequest)
		return nil, nil, fmt.Errorf("not a websocket upgrade")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		http.Error(w, "missing Sec-WebSocket-Key", http.StatusBadRequest)
		return nil, nil, fmt.Errorf("missing key")
	}
	h := sha1.New()
	h.Write([]byte(key + wsGUID))
	accept := base64.StdEncoding.EncodeToString(h.Sum(nil))

	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}
	conn, buf, err := hj.Hijack()
	if err != nil {
		return nil, nil, err
	}
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
	if _, err := buf.WriteString(resp); err != nil {
		conn.Close()
		return nil, nil, err
	}
	if err := buf.Flush(); err != nil {
		conn.Close()
		return nil, nil, err
	}
	return conn, buf.Reader, nil
}

// wsWriteFrame writes a single unmasked server frame (server→client is never masked).
func wsWriteFrame(conn net.Conn, opcode byte, payload []byte) error {
	var hdr []byte
	b0 := byte(0x80 | opcode) // FIN + opcode
	n := len(payload)
	switch {
	case n <= 125:
		hdr = []byte{b0, byte(n)}
	case n <= 65535:
		hdr = []byte{b0, 126, byte(n >> 8), byte(n)}
	default:
		hdr = make([]byte, 10)
		hdr[0] = b0
		hdr[1] = 127
		binary.BigEndian.PutUint64(hdr[2:], uint64(n))
	}
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Write(hdr); err != nil {
		return err
	}
	if n > 0 {
		if _, err := conn.Write(payload); err != nil {
			return err
		}
	}
	return nil
}

// wsReadFrame reads one client frame, unmasking as required (client→server must be masked).
func wsReadFrame(br *bufio.Reader) (opcode byte, payload []byte, err error) {
	h := make([]byte, 2)
	if _, err = io.ReadFull(br, h); err != nil {
		return 0, nil, err
	}
	opcode = h[0] & 0x0f
	masked := h[1]&0x80 != 0
	n := int(h[1] & 0x7f)
	switch n {
	case 126:
		e := make([]byte, 2)
		if _, err = io.ReadFull(br, e); err != nil {
			return 0, nil, err
		}
		n = int(binary.BigEndian.Uint16(e))
	case 127:
		e := make([]byte, 8)
		if _, err = io.ReadFull(br, e); err != nil {
			return 0, nil, err
		}
		n = int(binary.BigEndian.Uint64(e))
	}
	var mask []byte
	if masked {
		mask = make([]byte, 4)
		if _, err = io.ReadFull(br, mask); err != nil {
			return 0, nil, err
		}
	}
	payload = make([]byte, n)
	if _, err = io.ReadFull(br, payload); err != nil {
		return 0, nil, err
	}
	if masked {
		for i := 0; i < n; i++ {
			payload[i] ^= mask[i&3]
		}
	}
	return opcode, payload, nil
}
