package main

import "testing"

func TestParseFA(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want int64
		ok   bool
	}{
		{"standard 88.5 MHz", "FA00088500000;", 88500000, true},
		{"standard 104.3 MHz", "FA00104300000;", 104300000, true},
		{"partial, no terminator yet", "FA0008850", 0, false},
		{"bare query echo", "FA;", 0, false},
		{"leading error frame tolerated", "?;FA00104300000;", 104300000, true},
		{"IF status before FA tolerated", "IF00088500000     ;FA00088500000;", 88500000, true},
		{"non-FA prefix not mis-parsed", "XFA00088500000;", 0, false},
		{"first complete FA wins", "FA00090700000;FA00091200000;", 90700000, true},
		{"empty buffer", "", 0, false},
		{"junk only", "garbage;more;", 0, false},
		{"CR/LF around frame", "\r\nFA00098500000;\r\n", 98500000, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := parseFA([]byte(c.in))
			if ok != c.ok || got != c.want {
				t.Fatalf("parseFA(%q) = (%d,%v), want (%d,%v)", c.in, got, ok, c.want, c.ok)
			}
		})
	}
}
