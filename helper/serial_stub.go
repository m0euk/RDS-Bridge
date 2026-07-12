package main

import "fmt"

// serial/CAT + Omnirig frequency source — the 0.8.1 slot (Windows: SDR Console).
//
// Deliberately unimplemented in 0.8.0. This is the only reader that will pull in a
// native serial dependency; the rigctld path above stays pure stdlib. Kept here so
// the source interface and the -serial flag have a home and adding it later is a
// drop-in, not a restructure.
func newSerialSource(port string) (freqSource, error) {
	return nil, fmt.Errorf("serial/CAT source not implemented yet (planned for 0.8.1); use -rigctld for now")
}
