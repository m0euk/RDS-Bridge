# rds-bridge-helper

A small companion program for [RDS Bridge](https://github.com/m0euk/RDS-Bridge). It reads your SDR's
tuned frequency and feeds it to RDS Bridge over a local WebSocket, so that in **MPX mode** your catches
are logged by their real frequency instead of just `MPX`, and follow along as you retune.

It's optional and one-way: the helper only *reads* your SDR's frequency and never controls it. With no
helper running, RDS Bridge's MPX mode works exactly as before.

**Nothing to install.** The helper is a single self-contained binary (~5 MB) for macOS, Windows and Linux,
with no dependencies or runtime.

> Setup currently involves a little plumbing on the SDR side (see below), so for now it's best suited to
> users comfortable with that. A simpler, self-contained version that talks to common SDR software directly
> is planned for a later release.

## Get it

Download the binary for your platform from the [Releases](https://github.com/m0euk/RDS-Bridge/releases)
page, or build from source:

```
go build -o rds-bridge-helper .
```

On macOS and Linux, make the downloaded file executable first:

```
chmod +x rds-bridge-helper-*
```

macOS may also quarantine a downloaded binary; if it refuses to run, either clear the flag
(`xattr -d com.apple.quarantine rds-bridge-helper-*`) or allow it under System Settings → Privacy & Security.

## Run

```
rds-bridge-helper -rigctld localhost:4532
```

Then in RDS Bridge, switch to **MPX** mode and, in the new **Frequency helper** row, connect to
`ws://localhost:8765`. The panel should show your tuned frequency, and MPX catches will log by frequency.

If the helper and RDS Bridge run on different machines (e.g. an SDR on a Windows box, RDS Bridge on a Mac),
point RDS Bridge at the helper's LAN address instead of `localhost`. Keep it on your own machine or a
trusted local network — there is no authentication on this link, nor on the rigctld source it reads.

### Options

- `-rigctld addr` — rigctld TCP address to poll (default `localhost:4532`).
- `-listen addr` — WebSocket address RDS Bridge connects to (default `:8765`).
- `-poll dur` — how often to poll the frequency (default `500ms`).
- `-mock` — emit a scripted frequency with no SDR attached, for testing the link.
- `-source name` — a name for this source, shown in RDS Bridge's log.

## Getting your SDR's frequency to the helper

The helper reads frequency from a **rigctld** source (the Hamlib network protocol). Any SDR software or
radio that exposes rigctld will work:

- **SDR++** has a built-in rigctl server — enable it and point the helper at that port. No extra software.
- **SDR Console / SDRuno** speak Kenwood CAT over a serial port, so they need a bridge to rigctld:
  1. Create a virtual COM port pair with [com0com](https://sourceforge.net/projects/com0com/) (use a
     signed build; on Windows, enable "use Ports class" so the ports appear as real `COM` ports).
  2. In your SDR software, enable CAT / serial output on one port of the pair (Kenwood TS-2000, 57600).
  3. Run Hamlib's `rigctld` against the other port:
     ```
     rigctld -m 2014 -r COM12 -s 57600 -C serial_handshake=None
     ```
     **The `-C serial_handshake=None` is important** — over a virtual COM pair, the default hardware
     handshake blocks communication. Verify it's working with `rigctl -m 2 -r localhost:4532 f`, which
     should print the tuned frequency in Hz.
  4. Run the helper: `rds-bridge-helper -rigctld localhost:4532`.
- Many other SDR apps and radios (GQRX, CubicSDR, Hamlib-supported transceivers) expose rigctld too and
  work the same way.

## Protocol

The helper talks to RDS Bridge over a small, purpose-built WebSocket protocol, `rds-bridge-iq/1`
(RDS Bridge is the client; the helper is the server). This version implements its frequency-only ("meta")
mode. The protocol is documented in [`PROTOCOL-generic-iq.md`](../PROTOCOL-generic-iq.md) — if you'd like
to feed RDS Bridge from your own application, that's the spec to implement.

## Licence

MIT, matching RDS Bridge.
