# RDS Bridge

**A single-file, browser-based FM RDS decoder.** Download one `index.html`, double-click it, and decode
RDS from an SDRplay RSPdxR2 (via SDRConnect) or a networked SDR — no install, no server, no build step.

> Current release: **0.9.1-beta** · MIT licence · [rdsbridge.com](https://rdsbridge.com) ·
> [Discord](https://discord.gg/dNuqXhVyPt) · `info@rdsbridge.com`

RDS Bridge is a complete FM broadcast RDS decoder that runs entirely in your browser from a local file. It
speaks SDRConnect's own WebSocket API directly, so with an SDRplay receiver there's nothing else to install —
open the page, connect, and start decoding. It's built for DXers: confirmed-only decoding, a live RF
waterfall, a DX log, and — new in 0.9.0 — an automatic band scan.

---

## Features

- **Full RDS decode** — PS name, RadioText, PI code, PTY, alternative frequencies (AF), clock time (CT),
  TP/TA and stereo flags, with a live 57 kHz confidence readout and a PI-stability display.
- **Confirmed-only, never guessed** — e.g. country of origin is shown only once the ECC actually decodes it,
  not inferred from the PI. Error-correction and channel-bandwidth controls let you chase weak DX without
  fabricating catches.
- **Band scan** *(new in 0.9.0)* — sweeps the FM band, finds carriers from the RF spectrum, tunes each and
  logs the ones that decode RDS. Three modes — **Full band**, **DX watch**, **Watch list** — plus a skip
  list for your locals and an optional verbose per-channel log. See [Band scan](#band-scan) below.
- **Live RF waterfall** — the spectrum streamed from SDRConnect (or a SpyServer helper), with click-to-tune,
  zoom, and weak-signal lift.
- **Channel spacing** *(new in 0.9.1)* — choose the raster the ± tune buttons, wheel-scroll tuning and the
  band scan all follow: **Auto** (100 kHz Europe/rest-of-world, 200 kHz North America) or a fixed **50 / 100 /
  200 / 250 kHz**. 250 kHz reaches the quarter-MHz stations used in Thailand (88.25, 101.75 …); 50 kHz suits
  grids like Italy's.
- **DX log** — every catch recorded with PI, signal, and decode quality, exportable as CSV.
- **Antenna selector** — switch the RSPdxR2's antenna ports (A/B/C) from the page.
- **SDRConnect comparison** — shows SDRConnect's own decoded PS/RT/PI side-by-side with the Bridge decode.
- **Multiple sources** — a live SDRplay via SDRConnect; a **networked SDR** (SpyServer, rtl_tcp, or remote
  SDRConnect) through the companion helper; **MPX mode** for an external SDR's composite output; or an
  **IQ file** for offline decoding.
- **Adjustable views** — Compact, Essentials, **Pano**, Normal and Advanced layouts for anything from a
  glance to a full workbench. *Pano* *(new in 0.9.1)* is a band-watching view: the identification cards over
  a deep, screen-filling RF waterfall with an adjustable time-depth (max-hold) for spotting sporadic DX at a
  glance, plus audio and status chips.

---

## Requirements

- **A Chromium-based browser** — Chrome, Edge, or Brave. Safari and Firefox are **not** supported.
- **An SDR source**, most commonly an **SDRplay RSPdxR2** running **SDRConnect 1.0.6 or later** with its
  WebSocket API enabled (port 5454). Other SDRs work via the [helper](#networked-sdrs--the-helper).
- That's it — RDS Bridge is one `index.html` you run locally. Nothing is installed and nothing is uploaded;
  it runs on your machine and talks only to your SDR.

---

## Quick start

1. Download **`index.html`** from the [Releases](https://github.com/m0euk/RDS-Bridge/releases) page.
2. Double-click it — it opens in your browser from `file://`. (Use a Chromium browser.)
3. Start **SDRConnect** with your RSPdxR2 and a device started, and enable its WebSocket API.
4. In RDS Bridge, press **Connect**, then **Start**. Tune by clicking the waterfall or typing a frequency,
   and watch the RDS decode.

Keep the downloaded `index.html` somewhere handy (bookmark the local file) and re-download to update.

---

## Band scan

New in 0.9.0. In the **Decoder** panel, pick a **Scan mode** and press **Scan band**:

- **Full band** — one sweep of the whole band, logging everything it can decode. Run it first to build up
  your DX log and local-station list.
- **DX watch** — sweeps the whole band on a loop, skipping your skip-list, empty channels, strong-local
  splatter and dead carriers, so it converges on genuinely new signals. The mode to leave running during an
  opening; a DX you catch is never auto-skipped.
- **Watch list** — rapidly loops just the frequencies you choose (single freqs and ranges, e.g.
  `87.5-88.0 104.2`), for camping on the clear channels where Sporadic-E shows first.

The **skip list** (your locals) is built by ticking "skip" on DX-log rows, typing frequencies, or "＋ my
catches". Detection uses integrated channel power, and the channel step follows your **Spacing** setting — Auto
(region: 100 kHz, or 200 kHz on the odd tenths in North America) or a fixed 50 / 100 / 200 / 250 kHz, so the
scan can reach grids like Thailand's quarter-MHz stations. Every catch runs through the normal
decoder and PI commit guard — the scan only points the radio and watches, so it can't fabricate a station.
A non-verbose scan logs start, catches, a 30-second progress heartbeat, and stop; turn on **verbose scan
log** for a per-channel view with signal levels.

---

## Networked SDRs — the helper

RDS Bridge can decode a receiver on your network — **SpyServer**, **rtl_tcp**, or a remote **SDRConnect** —
through a small optional companion program, `rds-bridge-helper`. It streams a narrowed IQ feed to the
browser (which can't open raw sockets or buffer a jittery Wi-Fi stream itself). The same helper can also
feed your SDR's tuned frequency into **MPX mode**, so those catches log by real frequency.

The helper is a single ~5 MB download for Windows, macOS and Linux with nothing to install. Full setup is
in **[`helper/README.md`](helper/README.md)**.

> **Keep the pair in step:** from 0.8.6 the IQ stream is versioned — a mismatched helper/Bridge pair decodes
> garbage rather than erroring. Download both from the same release when in doubt.

---

## Browser support

RDS Bridge uses Web Audio, Web Workers and WebSockets from a `file://` page, and targets **Chromium**
(Chrome, Edge, Brave). Safari and Firefox are not supported. There is nothing to install and no data leaves
your machine.

---

## Licence

**MIT** — see [`LICENSE`](LICENSE). The MIT licence is retained deliberately so elements remain usable by
SDRplay in the closed-source SDRConnect. RDS Bridge itself (`index.html`) contains no third-party code; the
helper binaries bundle a few open-source libraries whose notices ship with each release.

---

*RDS Bridge is maintained by Graeme (M0EUK). Questions, catches and bug reports welcome on
[Discord](https://discord.gg/dNuqXhVyPt) or at `info@rdsbridge.com`.*
