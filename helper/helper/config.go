package main

// config.go — 0.8.1 persisted configuration.
//
// The config page writes this file next to the binary so a non-technical user sets things
// up once (pick the source, the COM port, the baud) and thereafter just launches the helper.
// Pure standard library (encoding/json); no new dependency.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const configFileName = "rds-bridge-helper.json"

// Config is the full persisted state. Only Source / SerialPort / Baud / Rigctld are exposed
// in the config page; Listen / PollMs / SourceName stay advanced (flags or hand-edited file).
type Config struct {
	Source     string `json:"source"`      // "serial" | "rigctld" | "mock"
	SerialPort string `json:"serial_port"` // e.g. "COM12"
	Baud       int    `json:"baud"`
	Rigctld    string `json:"rigctld"` // host:port
	PollMs     int    `json:"poll_ms"`
	Listen     string `json:"listen"` // host:port for the WebSocket + config page
	SourceName string `json:"source_name"`
}

func defaultConfig() Config {
	return Config{
		Source:     "serial", // graceful first run: serial-with-no-port waits calmly (amber) rather than a rigctld dial failing loudly (red)
		SerialPort: "",
		Baud:       serialDefaultBaud,
		Rigctld:    "", // left blank so the config page pre-fills this machine's detected LAN IP (what SDR++ needs); buildSource falls back to localhost:4532
		PollMs:     500,
		Listen:     "127.0.0.1:8765", // localhost by default — the feed is same-machine
		SourceName: "rds-bridge-helper",
	}
}

// configPath resolves the config file next to the executable, falling back to the working
// directory if the executable path can't be determined.
func configPath() string {
	if exe, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exe), configFileName)
	}
	return configFileName
}

// loadConfig returns the saved config (merged onto defaults) and whether a file existed.
func loadConfig() (Config, bool) {
	c := defaultConfig()
	b, err := os.ReadFile(configPath())
	if err != nil {
		return c, false
	}
	_ = json.Unmarshal(b, &c) // tolerate partial/older files — unset fields keep their defaults
	if c.Listen == "" {
		c.Listen = defaultConfig().Listen
	}
	if c.Baud <= 0 {
		c.Baud = serialDefaultBaud
	}
	return c, true
}

func saveConfig(c Config) error {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath(), b, 0o644)
}

func (c Config) pollInterval() time.Duration {
	if c.PollMs <= 0 {
		return 500 * time.Millisecond
	}
	return time.Duration(c.PollMs) * time.Millisecond
}

// buildSource constructs the live frequency source described by the config.
func (c Config) buildSource() (freqSource, error) {
	switch c.Source {
	case "serial":
		return newSerialSource(c.SerialPort, c.Baud)
	case "mock":
		return &mockSource{start: time.Now()}, nil
	default: // "rigctld"
		addr := c.Rigctld
		if addr == "" {
			addr = "localhost:4532"
		}
		return &rigctldSource{addr: addr}, nil
	}
}
