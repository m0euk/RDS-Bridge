# rds-bridge-helper

A small companion program for [RDS Bridge](https://github.com/m0euk/RDS-Bridge). It reads your SDR's
tuned frequency and feeds it to RDS Bridge over a local WebSocket, so that in **MPX mode** your catches
are logged by their real frequency (and shown in the main readout) instead of just `MPX`, and follow
along as you retune.

It's optional and one-way: the helper only *reads* your SDR's frequency and never controls it. With no
helper running, RDS Bridge's MPX mode works exactly as before.

**Nothing to install.** The helper is a single self-contained program (~5 MB) for Windows, macOS and
Linux, with no dependencies and no runtime. You run it, a setup page opens in your browser, and you pick
your settings from menus — no command line needed.

> **Tested on:** an Apple-silicon Mac with SDR++, and Windows with SDR Console. The Linux and Intel-Mac
> builds are provided and expected to work, but are not yet verified.

---

## 1. Download the right file

Get the file for your computer from the [Releases](https://github.com/m0euk/RDS-Bridge/releases) page:

| Your computer | File to download |
|---|---|
| Windows (most PCs) | `rds-bridge-helper-0.8.1-beta-windows-amd64.exe` |
| Mac with Apple silicon (M1/M2/M3/M4) | `rds-bridge-helper-0.8.1-beta-darwin-arm64` |
| Mac with Intel | `rds-bridge-helper-0.8.1-beta-darwin-amd64` |
| Linux | `rds-bridge-helper-0.8.1-beta-linux-amd64` |

Not sure which Mac you have? Click the Apple menu -> **About This Mac**. If it says **Apple M1/M2/M3...**,
use `darwin-arm64`. If it says **Intel**, use `darwin-amd64`.

---

## 2. Run it

### Windows

Double-click the `.exe`. A small **command-prompt window** opens - that's the helper running, leave it
be - and your web browser opens to the setup page. Go to **step 3**.

(If Windows SmartScreen warns about an unrecognised app, click **More info -> Run anyway**.)

### macOS - first time only

macOS quarantines programs downloaded from the web, so **the first time only** you clear that with two
one-off commands. Open **Terminal**, `cd` to the folder you downloaded the file into, and run (using
your file's name - this example is Apple silicon):

```
chmod +x rds-bridge-helper-0.8.1-beta-darwin-arm64
xattr -d com.apple.quarantine rds-bridge-helper-0.8.1-beta-darwin-arm64
```

That's it - you never need those two again.

### macOS - to run it (this time and every time after)

```
./rds-bridge-helper-0.8.1-beta-darwin-arm64
```

Your browser opens to the setup page. (On an Intel Mac, use the `darwin-amd64` filename throughout.)

> After the first-time `chmod` + `xattr` above, running the helper is just that one `./...` line - you do
> **not** repeat the `chmod`/`xattr` step on later runs.

### Linux

```
chmod +x rds-bridge-helper-0.8.1-beta-linux-amd64      # first time only
./rds-bridge-helper-0.8.1-beta-linux-amd64
```

---

## 3. Set it up (in the page that opened)

The setup page shows a live status and one question - **how does the helper read your tuned
frequency?** Pick your case:

- **SDR Console / CAT radio (serial COM port)** - choose your COM port and speed from the menus.
  See [SDR Console setup](#sdr-console-windows) below.
- **SDR++ or Hamlib (network / rigctld)** - the address box is **pre-filled with your computer's own IP
  address**, which is what SDR++ usually needs. Just press **Apply**.
- **Demo - no radio** - feeds a scripted frequency so you can test the link.

Press **Apply**. When it works, the status turns green and shows your tuned frequency.

Then, in **RDS Bridge**, switch to **MPX** mode and, in the **Frequency helper** row, connect to the
`ws://...` address shown on the page (there's a **Copy** button). Your catches now log - and the readout
shows - the real frequency, and follow you as you retune.

Your settings are **saved**, so next time you just run the helper and it works. Run it again any time to
see the status page; the **Stop helper** button on the page shuts it down (and closes that command-prompt
window).

---

## SDR Console (Windows)

SDR Console shares its tuned frequency over a **serial (CAT) port**. Two Windows programs can't share one
COM port, so you bridge them with a virtual COM pair - but you **no longer need Hamlib or rigctld**; the
helper reads the port directly.

1. Install a **signed** [com0com](https://sourceforge.net/projects/com0com/) virtual COM pair (e.g.
   COM11 <-> COM12); on the pair, tick **"use Ports class"** so they appear as real `COM` ports.
2. In SDR Console, enable **CAT** (Kenwood **TS-2000**) on **one** end of the pair - say **COM11** - and
   note the **speed** (57600 is typical).
3. On the helper page, choose **SDR Console / CAT radio**, pick the **other** end of the pair (**COM12**)
   and the **same speed**, then **Apply**.

That's the whole setup - no command line, no Hamlib, no `serial_handshake` flag (the helper handles that).

## SDR++ (any OS)

SDR++ has a built-in **Rigctl Server** - enable it. On the helper page, choose **SDR++ or Hamlib
(network)**. The address is pre-filled with **this computer's IP address**; SDR++'s server usually binds
to that address rather than `localhost`, so leave it as filled and press **Apply**. (If SDR++ runs on a
*different* machine, put that machine's IP in instead.)

---

## Advanced: command-line options

Everything the page does can also be set with flags, for automation or headless use (saved settings still
apply, and flags override them for that run):

- `-serial COMx` - read a CAT serial port (Kenwood TS-2000), e.g. `-serial COM12`.
- `-baud n` - serial speed (default `57600`).
- `-rigctld addr` - rigctld TCP address to poll, e.g. `-rigctld 192.168.1.20:4532`.
- `-mock` - emit a scripted frequency with no SDR attached, for testing the link.
- `-listen addr` - WebSocket + config-page address (default `127.0.0.1:8765`, i.e. this machine only).
- `-open always|never|firstrun` - whether to open the browser at startup (default `always`; use `never`
  for an auto-start-on-login setup so it doesn't pop a tab every boot).
- `-version` - print the version and exit.

## Keep it local

By default the helper listens on `127.0.0.1` (this machine only). There's no authentication on the link
or on the sources it reads, so if you change `-listen` to expose it, keep it to a trusted local network.

## Build from source

```
go build -o rds-bridge-helper .
```

The one dependency (`go.bug.st/serial`) is pinned in `go.mod`; `go build` fetches it. It builds as a
single static binary with no cgo. Cross-compile with `GOOS`/`GOARCH`, e.g.
`GOOS=windows GOARCH=amd64 go build`. For an offline/vendored build, run `go mod vendor` first.

## Protocol

The helper talks to RDS Bridge over a small, purpose-built WebSocket protocol, `rds-bridge-iq/1`
(RDS Bridge is the client; the helper is the server), in its frequency-only ("meta") mode. It's
documented in [`PROTOCOL-generic-iq.md`](../PROTOCOL-generic-iq.md) - the spec to implement if you'd like
to feed RDS Bridge from your own application.

## Licence

MIT, matching RDS Bridge.
