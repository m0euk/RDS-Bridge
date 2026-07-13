package main

// logging.go — 0.8.2.
//
// When the Windows helper is built with -H=windowsgui there is no console, so anything the
// helper writes to stderr is lost. To keep a record for post-mortems we also write the log
// to a file beside the binary (truncated at each start).
//
// One code path serves every build: a console build shows the log on stderr AND writes the
// file; a -H=windowsgui build's stderr write simply no-ops (its stderr handle is not usable)
// and the file captures everything. There is no build tag and no platform branch here.

import (
	"io"
	"log"
	"os"
	"path/filepath"
)

const logFileName = "rds-bridge-helper.log"

// besideExe resolves a path next to the executable, falling back to the working directory
// if the executable path can't be determined (mirrors configPath's placement rule).
func besideExe(name string) string {
	if exe, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exe), name)
	}
	return name
}

// tee fans a write out to several writers, ignoring each writer's individual error. On a
// -H=windowsgui build os.Stderr isn't usable; ignoring its error keeps the file writing.
// (io.MultiWriter is unsuitable here — it aborts on the first writer error, which would let
// a dead stderr suppress the file write.)
type tee []io.Writer

func (t tee) Write(p []byte) (int, error) {
	for _, w := range t {
		_, _ = w.Write(p)
	}
	return len(p), nil
}

// setupLogging points the standard logger at stderr + a fresh log file beside the binary.
// Call it once, only after this instance has won the listen socket, so a second (already-
// running) launch never truncates the running instance's log. Returns the open file (kept
// for the process lifetime; the OS closes it on exit) or nil if the file couldn't be made,
// in which case logging falls back to stderr only.
func setupLogging() *os.File {
	f, err := os.Create(besideExe(logFileName)) // truncate on start
	if err != nil {
		log.SetOutput(os.Stderr)
		log.Printf("could not open log file %s: %v (logging to console only)", besideExe(logFileName), err)
		return nil
	}
	log.SetOutput(tee{os.Stderr, f})
	return f
}
