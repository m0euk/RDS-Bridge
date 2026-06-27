# RDS Bridge

A browser-based weak-signal **RDS decoder for [SDRConnect](https://www.sdrplay.com/sdrconnect/)**, built for FM DXing. It pairs with SDRConnect over its WebSocket interface and decodes the RDS data stream in your browser — with an acquisition front-end designed to lock weak, fading signals that conventional decoders miss.

**▶ Download [`index.html`](index.html), save it, and open it in your browser.** It's a single self-contained file that runs entirely on your own machine — there's nothing to install.

---

## What it is

RDS Bridge takes the raw I/Q stream from SDRConnect and decodes RDS entirely in the browser (in a Web Worker — no server, no build step, one HTML file). It shows the station ID (PI), name (PS), programme type, RadioText, traffic flags, alternative frequencies and clock-time, alongside lock and signal-quality indicators tuned for weak-signal work.

Its distinguishing feature is an **NDA open-loop acquisition front-end** that locks weak and unstable FM signals from a cold start where conventional loop-based decoders hang. It also keeps a **DX log** of every catch, recording the conditions and what the decoder needed to resolve each one.

## Requirements

- **SDRConnect** running with its remote/WebSocket server enabled (an SDRplay receiver).
- A modern browser (Chrome, Edge, or Firefox).

## Running it

RDS Bridge must be **run from a local copy**: download `index.html`, save it to your computer, and open it in your browser (double-click it, or use File ▸ Open). Then click **Connect**.

> **Why does it have to run locally?** The app talks to SDRConnect through a WebSocket on your own machine (`ws://127.0.0.1:5454`). For security, browsers block a web page loaded from a remote site (such as GitHub Pages) from opening a connection to a local service — so a hosted copy cannot reach SDRConnect. Running the file from your own computer avoids this completely. Because it's a single self-contained file, "download and open" is all there is to it.

*(Advanced: serving the file from a local web server, e.g. `http://localhost`, also works — the restriction only affects pages loaded from a remote origin.)*

## Quick start

1. In SDRConnect, enable the remote/WebSocket server and tune your FM station.
2. In RDS Bridge: **Connect → choose your device → Start.**
3. Within a second or two of a lock you'll see PI, the station name, and the rest fill in.

## Reading the display

- **PI** — the station's unique ID code (hex). The hardiest field; it locks first, often before anything else is readable.
- **PS** — the 8-character station name. Needs more signal than PI, so on a weak catch you may see PI long before the name finishes assembling.
- **PTY / RadioText / TP / TA / Stereo / AF / Clock** — programme type, scrolling text, traffic flags, stereo pilot, alternative frequencies, and broadcast time.
- **Lock & quality** — *Sync* (block alignment), *Pilot* (a strong steady 19 kHz pilot means a genuinely coherent signal is present), *Data Q* (how clean the bitstream is), *SNR*.

## Two knobs worth trying on stubborn signals

- **Channel bandwidth** — narrowing it (130 kHz) rejects adjacent-channel splatter and can rescue a weak station crowded by neighbours; widen it (200–230 kHz) for clean, strong signals.
- **Error correction** — `≤2 bits` is a sound default; `≤3` recovers more at a slightly higher chance of a wrong fix; `off` gives the purest reads.

## DX log

Every fully-identified live catch is logged automatically with its frequency, PI, name, and the conditions it took to resolve it — SNR, pilot strength, data quality, whether error-correction was needed, and time-to-ID. Export to CSV for your records; the log persists between sessions in your browser.

## How it works (technical)

RDS rides a 57 kHz subcarrier (the third harmonic of the 19 kHz stereo pilot) at 1187.5 bits/s, differentially encoded and bi-phase modulated on a suppressed DBPSK carrier. Data is grouped into 26-bit blocks (16 information + 10 check), four to a group, each block carrying an offset word that drives synchronisation. The PI code sits in block A of every group, repeating ~11 times a second.

**The headline — NDA open-loop acquisition.** A conventional decoder closes a Costas carrier loop, a timing loop and a pilot PLL simultaneously from a cold start. On weak or fading signals these loops fight each other and the decoder *hangs* even though a decodable signal is present. RDS Bridge instead acquires open-loop and non-data-aided: it estimates symbol timing feed-forward with an Oerder–Meyr-style estimator (recovering the symbol-rate spectral line directly — no loop to hang), seeds the Costas carrier from it, and holds the Gardner timing feedback disabled until a coarse lock exists. Only then does it hand over to the closed loops for fine tracking. The result is fast, repeatable lock on signals where loop-based decoders stall — the core advance of the project.

Other elements: a Manchester-matched filter before timing recovery; a gear-shift loop strategy (wide during pull-in, narrow once locked); differential decoding to neutralise the suppressed carrier's 180° phase ambiguity; and syndrome-based block synchronisation with configurable burst error-correction over the (26,16) shortened cyclic code.

**Experimental paths (off by default, honest result).** Two further ideas — *soft-PI integration* (accumulating confidence-weighted PI evidence across sub-threshold groups) and *blind soft-PI* (a 104-phase bank that finds group phase without hard sync) — were built and measured against the baseline using the in-app test harness. On real signals both proved at best marginal: under controlled noise they tie the normal decoder and don't meaningfully extend the threshold. They're retained, off by default, as the foundation for future work. **The frozen baseline is the NDA decoder alone.**

## Advanced / developer mode

Add `?dev=1` to the URL, or click **advanced** in the header, to reveal developer tools: an offline IQ-file test harness (drag in a `.wav` recording, inject calibrated noise and fading, and auto-sweep the decode threshold in dB), the experimental soft/blind read-outs, and low-level decoder switches. None of it is needed for normal listening.

## Licence

Released under the [MIT Licence](LICENSE) — free to use, modify and redistribute, including commercially, provided the copyright and licence notice are retained. Provided "as is", without warranty.

## Author

Written by **Graeme Stoker, M0EUK**. Comments and feedback welcome: graemest@gmail.com
Contributions via pull request or issue are welcome.
