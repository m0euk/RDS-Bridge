package main

// serial.go — 0.8.1 native serial/CAT frequency reader.
//
// Reads an SDR application's tuned frequency straight off its Kenwood TS-2000 CAT
// serial port (e.g. SDR Console on Windows). This drops the Hamlib/rigctld + com0com
// detour that the 0.8.0 setup needed — the single worst part of that experience.
//
// This is the only reader that pulls in a native serial dependency; the rigctld and
// mock paths stay pure standard library.
//
// HANDSHAKE: go.bug.st/serial exposes no flow-control setting and never enables
// hardware (RTS/CTS) handshake, so the 0.8.0 "serial_handshake=None" lesson holds by
// construction — a virtual COM pair won't block writes the way it did through the
// Hamlib TS-2000 backend's default hardware handshake.

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"go.bug.st/serial"
)

const (
	serialDefaultBaud = 57600 // matches the proven 0.8.0 SDR Console / rigctld setup; override with -baud
	serialReadTimeout = 300 * time.Millisecond
	serialReplyWait   = 1200 * time.Millisecond
)

type serialSource struct {
	portName string
	baud     int
	p        serial.Port
}

// newSerialSource validates arguments and returns the reader. The port is opened lazily
// on the first read() so a not-yet-present port is retried by the poll loop, exactly like
// rigctld — rather than failing hard at startup.
func newSerialSource(port string, baud int) (freqSource, error) {
	if port == "" {
		return nil, fmt.Errorf("serial: no port given (use -serial COMx)")
	}
	if baud <= 0 {
		baud = serialDefaultBaud
	}
	return &serialSource{portName: port, baud: baud}, nil
}

func (s *serialSource) label() string {
	return fmt.Sprintf("serial %s @%d (Kenwood CAT)", s.portName, s.baud)
}

func (s *serialSource) close() { s.reset() }

func (s *serialSource) reset() {
	if s.p != nil {
		s.p.Close()
		s.p = nil
	}
}

func (s *serialSource) open() error {
	mode := &serial.Mode{
		BaudRate: s.baud,
		DataBits: 8,
		Parity:   serial.NoParity,
		StopBits: serial.OneStopBit,
		// no FlowControl field exists → no RTS/CTS handshake (the 0.8.0 lesson, by default)
	}
	p, err := serial.Open(s.portName, mode) // go.bug.st/serial auto-prefixes \\.\ for COM10+ on Windows
	if err != nil {
		return err
	}
	if err := p.SetReadTimeout(serialReadTimeout); err != nil {
		p.Close()
		return err
	}
	s.p = p
	return nil
}

// read sends the Kenwood "FA;" query (VFO A frequency) and parses the "FA<digits>;" reply.
func (s *serialSource) read() (int64, error) {
	if s.p == nil {
		if err := s.open(); err != nil {
			return 0, err
		}
	}
	_ = s.p.ResetInputBuffer() // drop any stale / unsolicited status frames
	if _, err := s.p.Write([]byte("FA;")); err != nil {
		s.reset()
		return 0, err
	}

	deadline := time.Now().Add(serialReplyWait)
	var buf []byte
	tmp := make([]byte, 64)
	for time.Now().Before(deadline) {
		n, err := s.p.Read(tmp)
		if err != nil {
			s.reset()
			return 0, err
		}
		if n == 0 {
			continue // read-timeout tick with no data; keep waiting until the reply deadline
		}
		buf = append(buf, tmp[:n]...)
		if hz, ok := parseFA(buf); ok {
			return hz, nil
		}
	}
	return 0, fmt.Errorf("serial: no FA reply within timeout (check the port and baud, and that CAT is enabled in your SDR software)")
}

// parseFA scans a CAT byte stream for a complete "FA<digits>;" reply and returns the Hz.
// It tolerates other ';'-terminated frames (status, echoes) interleaved in the buffer.
func parseFA(buf []byte) (int64, bool) {
	rest := string(buf)
	for {
		i := strings.IndexByte(rest, ';')
		if i < 0 {
			return 0, false // no complete frame yet
		}
		frame := rest[:i]
		rest = rest[i+1:]
		frame = strings.TrimSpace(frame) // tolerate stray CR/LF/spaces around frames
		if !strings.HasPrefix(frame, "FA") {
			continue
		}
		digits := frame[2:]
		if digits == "" {
			continue // bare "FA;" echo of the query, no value
		}
		hz, err := strconv.ParseInt(digits, 10, 64)
		if err == nil && hz > 0 {
			return hz, true
		}
	}
}
