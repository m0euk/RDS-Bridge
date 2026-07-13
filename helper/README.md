# rds-bridge-helper

A small companion program for [RDS Bridge](https://github.com/m0euk/RDS-Bridge). It reads your SDR's
tuned frequency and feeds it to RDS Bridge over a local WebSocket, so that in **MPX mode** your catches
are logged by their real frequency (and shown in the main readout) instead of just `MPX`, and follow
along as you retune.

It's optional and one-way: the helper only *reads* your SDR's frequency and never controls it. With no
helper running, RDS Bridge's MPX mode works exactly as before.

**Nothing to install.** The helper is a single self-contained program (~5 MB) for Windows, macOS and
Linux, with no dependencies and no runtime. You run it, a setup page opens in your browser, and you pick
your settings from menus — no command line needed. On Windows it runs with no command-prompt window; on
macOS it's a double-clickable app that runs quietly in the background.

> **Tested on:** an Apple-silicon Mac (the `.app`) with SDR++, and Windows with SDR Console. The Linux
> and Intel-Mac builds are provided and expected to work, but are not yet verified.

---

## 1. Download the right file

Get the file for your computer from the [Releases](https://github.com/m0euk/RDS-Bridge/releases) page:

| Your computer | File to download |
|---|---|
| Windows (most PCs) | `rds-bridge-helper-0.8.2-beta-windows-amd64.exe` |
| Mac (Apple silicon **or** Intel) | `RDS-Bridge-Helper-0.8.2-beta-macos-app.zip` |
| Linux | `rds-bridge-helper-0.8.2-beta-linux-amd64` |

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

1. Double-click `RDS-Bridge-Helper-0.8.2-beta-macos-app.zip` in Finder to unzip it — you get
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
> binary. First time only: `chmod +x rds-bridge-helper-0.8.2-beta-darwin-arm64` then
> `xattr -d com.apple.quarantine rds-bridge-helper-0.8.2-beta-darwin-arm64`. To run:
> `./rds-bridge-helper-0.8.2-beta-darwin-arm64`. (On an Intel Mac use the `darwin-amd64` filename.)

### Linux

```
chmod +x rds-bridge-helper-0.8.2-beta-linux-amd64      # first time only
./rds-bridge-helper-0.8.2-beta-linux-amd64
```

---

## 3. Set it up (in the page that opened)

The setup page shows a live status and one question — **how does the helper read your tuned
frequency?** Pick your case:

- **SDR Console / CAT radio (serial COM port)** — choose your COM port and speed from the menus.
  See [SDR Console setup](#sdr-console-windows) below.
- **SDR++ or Hamlib (network / rigctld)** — the address box is **pre-filled with your computer's own IP
  address**, which is what SDR++ usually needs. Just press **Apply**.
- **Demo — no radio** — feeds a scripted frequency so you can test the link.

Press **Apply**. When it works, the status turns green and shows your tuned frequency.

Then, in **RDS Bridge**, switch to **MPX** mode and, in the **Frequency helper** row, connect to the
`ws://...` address shown on the page (there's a **Copy** button). Your catches now log — and the readout
shows — the real frequency, and follow you as you retune.

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
(including the no-console Windows build and the universal macOS `.app`), run `./build.sh` on a Mac.

## Protocol

The helper talks to RDS Bridge over a small, purpose-built WebSocket protocol, `rds-bridge-iq/1`
(RDS Bridge is the client; the helper is the server), in its frequency-only ("meta") mode. It's
documented in [`PROTOCOL-generic-iq.md`](../PROTOCOL-generic-iq.md) — the spec to implement if you'd like
to feed RDS Bridge from your own application.

## Licence

MIT, matching RDS Bridge.
