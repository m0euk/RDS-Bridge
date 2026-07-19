package main

// wsclient.go — 0.8.9 minimal client-side WebSocket (RFC 6455).
//
// The helper's ws.go is SERVER-side (Bridge connects in). The SDRConnect source is the
// opposite: the helper is the CLIENT connecting out to SDRConnect's WebSocket on :5454.
// Client→server frames MUST be masked (§5.3 RFC 6455); server→client frames are not.
// Stdlib only — keeps the single-static-binary, cgo-free rule. Text + binary + ping/pong
// + close + fragmentation reassembly is all this needs.

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"time"
)

// wsConn is a connected client WebSocket. Writes take the lock (concurrent with the
// read loop, exactly like the server-side client type).
type wsConn struct {
	conn net.Conn
	br   *bufio.Reader
}

// wsClientDial opens ws://host:port[/path] and performs the RFC 6455 client handshake,
// verifying the server's Sec-WebSocket-Accept. addr may be a bare host:port or a full
// ws:// URL. wss:// is not handled here (SDRConnect serves ws on the LAN; §9 of the
// generic protocol notes browser secure-context rules don't apply to this native hop).
func wsClientDial(ctx context.Context, addr string) (*wsConn, error) {
	host, path := parseWSAddr(addr)
	d := net.Dialer{Timeout: 5 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", host)
	if err != nil {
		return nil, fmt.Errorf("ws: dial %s: %w", host, err)
	}
	// close on ctx cancel so a blocked handshake read unblocks promptly
	stop := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-stop:
		}
	}()
	defer close(stop)

	kb := make([]byte, 16)
	if _, err := rand.Read(kb); err != nil {
		_ = conn.Close()
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(kb)
	// SDRConnect's HTTP layer 404s a handshake missing the headers a browser always
	// sends (Origin in particular). Bridge connects from a file:// page, whose Origin is
	// "null"; we send the same so this native client is accepted identically. (0.8.9)
	req := "GET " + path + " HTTP/1.1\r\n" +
		"Host: " + host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Origin: null\r\n" +
		"User-Agent: rds-bridge-helper\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Write([]byte(req)); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ws: write handshake: %w", err)
	}

	br := bufio.NewReaderSize(conn, 1<<16)
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	status, err := br.ReadString('\n')
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ws: read status: %w", err)
	}
	if !strings.Contains(status, "101") {
		_ = conn.Close()
		return nil, fmt.Errorf("ws: server did not upgrade: %s", strings.TrimSpace(status))
	}
	var gotAccept string
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("ws: read headers: %w", err)
		}
		if line == "\r\n" {
			break
		}
		if k, v, ok := strings.Cut(line, ":"); ok && strings.EqualFold(strings.TrimSpace(k), "Sec-WebSocket-Accept") {
			gotAccept = strings.TrimSpace(v)
		}
	}
	h := sha1.New()
	h.Write([]byte(key + wsGUID)) // wsGUID from ws.go
	wantAccept := base64.StdEncoding.EncodeToString(h.Sum(nil))
	if gotAccept != wantAccept {
		_ = conn.Close()
		return nil, fmt.Errorf("ws: bad Sec-WebSocket-Accept")
	}
	_ = conn.SetReadDeadline(time.Time{}) // clear; the read loop sets its own
	return &wsConn{conn: conn, br: br}, nil
}

// parseWSAddr accepts "host:port", "ws://host:port", or "ws://host:port/path" and
// returns the dial host:port and the request path (default "/").
func parseWSAddr(addr string) (host, path string) {
	path = "/"
	if strings.Contains(addr, "://") {
		if u, err := url.Parse(addr); err == nil {
			host = u.Host
			if u.Path != "" {
				path = u.Path
			}
			return host, path
		}
	}
	return addr, path
}

// writeText sends a masked text frame (opcode 0x1).
func (c *wsConn) writeText(b []byte) error { return c.writeFrame(0x1, b) }

// writeFrame writes a single masked client frame.
func (c *wsConn) writeFrame(opcode byte, payload []byte) error {
	var hdr []byte
	b0 := byte(0x80 | opcode) // FIN + opcode
	n := len(payload)
	switch {
	case n <= 125:
		hdr = []byte{b0, byte(0x80 | n)} // mask bit set
	case n <= 65535:
		hdr = []byte{b0, 0x80 | 126, byte(n >> 8), byte(n)}
	default:
		hdr = make([]byte, 10)
		hdr[0] = b0
		hdr[1] = 0x80 | 127
		binary.BigEndian.PutUint64(hdr[2:], uint64(n))
	}
	var mask [4]byte
	if _, err := rand.Read(mask[:]); err != nil {
		return err
	}
	masked := make([]byte, n)
	for i := 0; i < n; i++ {
		masked[i] = payload[i] ^ mask[i&3]
	}
	_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := c.conn.Write(hdr); err != nil {
		return err
	}
	if _, err := c.conn.Write(mask[:]); err != nil {
		return err
	}
	if n > 0 {
		if _, err := c.conn.Write(masked); err != nil {
			return err
		}
	}
	return nil
}

// readMessage returns the next complete application message (text 0x1 or binary 0x2),
// reassembling fragments and transparently answering ping with pong. A close frame
// returns io.EOF. Control frames other than ping/close are skipped.
func (c *wsConn) readMessage() (opcode byte, payload []byte, err error) {
	var msgOp byte
	var buf []byte
	for {
		fin, op, frag, ferr := c.readFrameRaw()
		if ferr != nil {
			return 0, nil, ferr
		}
		switch op {
		case 0x9: // ping -> pong (echo payload)
			_ = c.writeFrame(0xA, frag)
			continue
		case 0xA: // pong — ignore
			continue
		case 0x8: // close
			return 0, nil, io.EOF
		case 0x0: // continuation
			buf = append(buf, frag...)
		case 0x1, 0x2: // start of a data message
			msgOp = op
			buf = append(buf[:0], frag...)
		default:
			continue // unknown opcode; skip
		}
		if fin && (op == 0x0 || op == 0x1 || op == 0x2) {
			return msgOp, buf, nil
		}
	}
}

// readFrameRaw reads one WebSocket frame from a server (unmasked) and returns its FIN
// bit, opcode and payload.
func (c *wsConn) readFrameRaw() (fin bool, opcode byte, payload []byte, err error) {
	h := make([]byte, 2)
	if _, err = io.ReadFull(c.br, h); err != nil {
		return false, 0, nil, err
	}
	fin = h[0]&0x80 != 0
	opcode = h[0] & 0x0f
	masked := h[1]&0x80 != 0 // servers must not mask, but tolerate it
	n := int(h[1] & 0x7f)
	switch n {
	case 126:
		e := make([]byte, 2)
		if _, err = io.ReadFull(c.br, e); err != nil {
			return false, 0, nil, err
		}
		n = int(binary.BigEndian.Uint16(e))
	case 127:
		e := make([]byte, 8)
		if _, err = io.ReadFull(c.br, e); err != nil {
			return false, 0, nil, err
		}
		n = int(binary.BigEndian.Uint64(e))
	}
	var mask []byte
	if masked {
		mask = make([]byte, 4)
		if _, err = io.ReadFull(c.br, mask); err != nil {
			return false, 0, nil, err
		}
	}
	payload = make([]byte, n)
	if _, err = io.ReadFull(c.br, payload); err != nil {
		return false, 0, nil, err
	}
	if masked {
		for i := 0; i < n; i++ {
			payload[i] ^= mask[i&3]
		}
	}
	return fin, opcode, payload, nil
}

func (c *wsConn) close() error { return c.conn.Close() }
