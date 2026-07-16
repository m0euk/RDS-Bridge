# rds-bridge-helper

A small companion program for [RDS Bridge](https://github.com/m0euk/RDS-Bridge). It does one of two jobs —
you pick which on its setup page:

- **Network SDR (from 0.8.6)** — reads a **live IQ stream** from a receiver on your network (SpyServer or
  rtl_tcp), narrows it, and streams it to RDS Bridge, which decodes it and plays the audio. **No other SDR
  software needed.** A browser can't open a raw TCP socket and both servers speak raw TCP, which is the whole
  reason this program exists.
- **Frequency helper (from 0.8.0)** — reads your SDR's **tuned frequency** and feeds it to RDS Bridge, so that
  in **MPX mode** your catches log by their real frequency (and show in the main readout) instead of just
  `MPX`, and follow along as you retune. One-way: it only *reads* the frequency, never controls the radio.

The two are mutually exclusive — one helper, one job at a time. Both are optional; with no helper running,
RDS Bridge's other sources work exactly as before.

> ### ⚠ Keep the helper and RDS Bridge on the same version
> From 0.8.6 the IQ stream is tagged, and a mismatched pair (an old helper with a new Bridge, or the reverse)
> gives you **garbled audio and junk decode rather than a clean error**. If a setup that was working suddenly
> decodes nonsense, check this first. Download both from the same release.

**Nothing to install.** The helper is a single self-contained program (~5 MB) for Windows, macOS and
Linux, with no dependencies and no runtime. You run it, a setup page opens in your browser, and you pick
your settings from menus — no command line needed. On Windows it runs with no command-prompt window; on
macOS it's a double-clickable app that runs quietly in the background.

> **Tested on:** an Apple-silicon Mac (the `.app`) with SDR++ and with SpyServer over the LAN, and Windows
> with SDR Console. The Linux and Intel-Mac builds are provided and expected to work, but are not verified.
>
> **⚠ The rtl_tcp source is experimental and has never been run against a real dongle** — it is written and
> unit-tested against the protocol, but nobody here owns one. It may well work; it isn't a claim. If you have
> an RTL-SDR and want the tested route, run it behind **SpyServer**, which fronts RTL dongles and *is* tested.
> Either way, please report what you find.

---

## 1. Download the right file

Get the file for your computer from the [Releases](https://github.com/m0euk/RDS-Bridge/releases) page:

| Your computer | File to download |
|---|---|
| Windows (most PCs) | `rds-bridge-helper-0.8.6-beta-windows-amd64.exe` |
| Mac (Apple silicon **or** Intel) | `RDS-Bridge-Helper-0.8.6-beta-macos-app.zip` |
| Linux | `rds-bridge-helper-0.8.6-beta-linux-amd64` |

The Mac download is a single **app** that works on both Apple-silicon and Intel Macs. (If you'd rather
run a plain command-line program on the Mac, the `…-darwin-arm64` / `…-darwin-amd64` binaries are also on
the Releases page — see "Command-line binary" under macOS below.)

---

## 2. Run it

### Windows

Double-click the `.exe`. Your web browser opens to the setup page — that's it, no window to leave open.
Go to **step 3**.

(If Windows SmartScreen warns about an unrecognised app, click **More info → Run anyway**. This is
expected — the program isn't code-signed.)

The helper runs quietly in the background. To stop it, use the **Stop helper** button on the setup page
(see step 3). Its status log is written to `rds-bridge-helper.log` next to the `.exe`, in case you ever
need to check what it's doing.

### macOS

1. Double-click `RDS-Bridge-Helper-0.8.6-beta-macos-app.zip` in Finder to unzip it — you get
   **RDS Bridge Helper.app**.
2. **First time only**, clear the download quarantine so macOS will run an unsigned app. Open
   **Terminal**, type the command below (note the space after `com.apple.quarantine`), then drag the app
   onto the Terminal window so its path fills in, and press Enter:

   ```
   xattr -dr com.apple.quarantine "RDS Bridge Helper.app"
   ```

   (This is the same one-off step other SDR tools like WavViewDX need. You never repeat it.)
3. Double-click **RDS Bridge Helper.app**. Your browser opens to the setup page. The app runs quietly in
   the background with no Dock icon; stop it with the **Stop helper** button on the page.

Its status log is written to `rds-bridge-helper.log` inside the app bundle
(`RDS Bridge Helper.app/Contents/MacOS/`), in case you need it.

> **Command-line binary (optional, for terminal users).** Instead of the app you can run the plain
> binary. First time only: `chmod +x rds-bridge-helper-0.8.6-beta-darwin-arm64` then
> `xattr -d com.apple.quarantine rds-bridge-helper-0.8.6-beta-darwin-arm64`. To run:
> `./rds-bridge-helper-0.8.6-beta-darwin-arm64`. (On an Intel Mac use the `darwin-amd64` filename.)

### Linux

```
chmod +x rds-bridge-helper-0.8.6-beta-linux-amd64      # first time only
./rds-bridge-helper-0.8.6-beta-linux-amd64
```

---

## 3. Set it up (in the page that opened)

The setup page shows a live status and one question — **what should the helper read?** Pick your case:

**To decode a networked SDR (no other SDR software):**

- **Network SDR — Airspy / RTL-SDR over SpyServer** — enter your SpyServer's address. On the same machine,
  leave the default (`localhost:5555`). **This is the tested route.**
- **Network SDR — RTL-SDR over rtl_tcp (experimental)** — your rtl_tcp address (default `localhost:1234`).
  See the warning at the top: never tested on real hardware.

Press **Apply**. Then, in **RDS Bridge**, choose the **Network SDR** source and connect to the `ws://…`
address shown on the page (there's a **Copy** button). Tune from RDS Bridge — the helper follows, and with
SpyServer you get the RF waterfall too. You still run rtl_tcp or spyserver yourself; the helper connects
*out* to it, and it can be on this machine or another box on your network.

**To feed your tuned frequency into MPX mode:**

- **SDR Console / CAT radio (serial COM port)** — choose your COM port and speed from the menus.
  See [SDR Console setup](#sdr-console-windows) below.
- **SDR++ or Hamlib (network / rigctld)** — the address box is **pre-filled with your computer's own IP
  address**, which is what SDR++ usually needs. Just press **Apply**.
- **Demo — no radio** — feeds a scripted frequency so you can test the link.

Press **Apply**. When it works, the status turns green and shows your tuned frequency. Then, in **RDS
Bridge**, switch to **MPX** mode and, in the **Frequency helper** row, connect to the `ws://...` address
shown on the page. Your catches now log — and the readout shows — the real frequency, and follow you as
you retune.

Your settings are **saved**, so next time you just run the helper and it works. Run it again any time to
see the status page (running it a second time simply reopens the page of the copy already running). The
**Stop helper** button on the page shuts it down.

---

## SDR Console (Windows)

SDR Console shares its tuned frequency over a **serial (CAT) port**. Two Windows programs can't share one
COM port, so you bridge them with a virtual COM pair — but you **no longer need Hamlib or rigctld**; the
helper reads the port directly.

1. Install a **signed** [com0com](https://sourceforge.net/projects/com0com/) virtual COM pair (e.g.
   COM11 ↔ COM12); on the pair, tick **"use Ports class"** so they appear as real `COM` ports.
2. In SDR Console, enable **CAT** (Kenwood **TS-2000**) on **one** end of the pair — say **COM11** — and
   note the **speed** (57600 is typical).
3. On the helper page, choose **SDR Console / CAT radio**, pick the **other** end of the pair (**COM12**)
   and the **same speed**, then **Apply**.

That's the whole setup — no command line, no Hamlib, no `serial_handshake` flag (the helper handles that).

## SDR++ (any OS)

SDR++ has a built-in **Rigctl Server** — enable it. On the helper page, choose **SDR++ or Hamlib
(network)**. The address is pre-filled with **this computer's IP address**; SDR++'s server usually binds
to that address rather than `localhost`, so leave it as filled and press **Apply**. (If SDR++ runs on a
*different* machine, put that machine's IP in instead.)

---

## Advanced: command-line options

Everything the page does can also be set with flags, for automation or headless use (saved settings still
apply, and flags override them for that run):

- `-serial COMx` — read a CAT serial port (Kenwood TS-2000), e.g. `-serial COM12`.
- `-baud n` — serial speed (default `57600`).
- `-rigctld addr` — rigctld TCP address to poll, e.g. `-rigctld 192.168.1.20:4532`.
- `-spyserver addr` — SpyServer IQ source, e.g. `-spyserver 192.168.1.10:5555` (Network SDR mode).
- `-rtltcp addr` — rtl_tcp IQ source, e.g. `-rtltcp 192.168.1.10:1234` (Network SDR mode, experimental).
- `-iqfreq hz` — starting centre frequency for a Network SDR source, e.g. `-iqfreq 98500000`.
- `-mock` — emit a scripted frequency with no SDR attached, for testing the link.
- `-listen addr` — WebSocket + config-page address (default `127.0.0.1:8765`, i.e. this machine only).
- `-open always|never|firstrun` — whether to open the browser at startup (default `always`; `never` is
  handy if you launch the helper from your own login/startup script and don't want a tab each time).
- `-version` — print the version and exit.

## Keep it local

By default the helper listens on `127.0.0.1` (this machine only). There's no authentication on the link
or on the sources it reads, so if you change `-listen` to expose it, keep it to a trusted local network.

## Build from source

```
go build -o rds-bridge-helper .
```

The one dependency (`go.bug.st/serial`) is pinned in `go.mod` and its checksums are committed in `go.sum`,
so the build needs no extra steps. It produces a single static binary with no cgo. Cross-compile with
`GOOS`/`GOARCH`, e.g. `GOOS=windows GOARCH=amd64 go build`. To build every release target at once
(including the no-console Windows build and the universal macOS `.app`), run `bash build.sh` on a Mac —
it needs `lipo` and `ditto`, so macOS only. (`bash build.sh` rather than `./build.sh` because files
uploaded through GitHub's web interface arrive without the executable bit; `chmod +x build.sh` first if
you prefer the shorter form.)

## Protocol

The helper talks to RDS Bridge over a small, purpose-built WebSocket protocol, `rds-bridge-iq/1` (RDS Bridge
is the client; the helper is the server). It uses the frequency-only (`meta`) mode for the frequency helper,
and the `iq16` mode — int16 IQ plus an optional uint8 display FFT — for Network SDR. It's documented in
[`PROTOCOL-generic-iq.md`](../PROTOCOL-generic-iq.md), which is the spec to implement if you'd like to feed
RDS Bridge from your own application. The helper is the reference implementation of it, and
`protocol_test.go` guards the wire bytes against drift.

## Licence

MIT, matching RDS Bridge.

**Third-party components.** The helper binaries include a small number of open-source libraries
(BSD-3-Clause and MIT). Their notices are in
[`THIRD-PARTY-NOTICES.md`](https://github.com/m0euk/RDS-Bridge/blob/main/helper/THIRD-PARTY-NOTICES.md),
which is also attached to every release. RDS Bridge itself (`index.html`) has no third-party code.
