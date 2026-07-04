# RDS Bridge

A browser-based weak-signal **RDS decoder for [SDRConnect](https://www.sdrplay.com/sdrconnect/)**, built for FM DXing. It pairs with SDRConnect over its WebSocket interface and decodes the RDS data stream in your browser — with an acquisition front-end designed to lock weak, fading signals that conventional decoders miss.

**▶ Download [`index.html`](https://github.com/m0euk/RDS-Bridge/blob/main/index.html), save it, and open it in your browser.** It's a single self-contained file that runs entirely on your own machine — there's nothing to install.

---

## What it is

RDS Bridge takes the raw I/Q stream from SDRConnect and decodes RDS entirely in the browser (in a Web Worker — no server, no build step, one HTML file). It shows the station ID (PI), name (PS), programme type, RadioText, traffic flags, alternative frequencies and clock-time, alongside lock and signal-quality indicators tuned for weak-signal work.

Its distinguishing feature is an **NDA open-loop acquisition front-end** that locks weak and unstable FM signals from a cold start where conventional loop-based decoders hang.

It's also a self-contained **live monitor**: an RF band waterfall and an MPX composite waterfall, live audio from SDRConnect, **click-to-tune** straight from the band display, a **57k confidence** predictor that estimates how likely a fading station is to yield an ID this pass, and a live **57k constellation** that shows how close a signal is to decoding, and a **PI-stability** trace that shows how decisively one station ID is winning out as evidence accumulates. And it keeps a **DX log** of every catch, recording the conditions and what the decoder needed to resolve each one.

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

- **PI** — the station's unique ID code (hex). The hardiest field; it locks first, often before anything else is readable. A PI is committed only once received more than once (a repetition guard against false single-read decodes).
- **PS** — the 8-character station name. Needs more signal than PI, so on a weak catch you may see PI long before the name finishes assembling.
- **PTY / RadioText / TP / TA / Stereo / AF / Clock** — programme type, scrolling text, traffic flags, stereo pilot, alternative frequencies, and broadcast time. A **RoW / NA** toggle in the header switches the programme-type labels between the European (RDS / EN 50067) and North American (RBDS / NRSC-4) tables — the on-air value is identical, only the label set differs, so it's a manual choice with no auto-detect.
- **Lock & quality** — *Sync* (block alignment), *Pilot* (a strong steady 19 kHz pilot means a genuinely coherent signal is present), *Data Q* (how clean the bitstream is), *SNR*.

## Live monitoring

- **RF waterfall** — the captured band as a scrolling spectrum, with an MHz scale and a green marker on the channel being decoded. Readability controls let you match the band: **floor** and **ceil** set where the palette starts (black) and tops out (white), **lift** is a weak-signal stretch that brightens faint stations just above the floor without washing out the strong ones, and **avg** is frame averaging that smooths the noise floor. **Zoom** (1–8×, from the dropdown or by scrolling the mouse wheel over the waterfall) magnifies a crowded stretch, with a **follow / free** view mode — follow recentres on the frequency you tune, free keeps the view fixed and lets you drag to pan. **Click-to-tune**: click the waterfall (or its scale) to retune SDRConnect's VFO there; **snap** rounds the click to a frequency step (default 100 kHz) to match your tuning grid. A **centre** button (⌖) recentres the whole capture on the station you're tuned to, bringing a catch near the edge of the span into the middle where the band is cleanest — your tuning and RDS lock are kept (needs SDRConnect hardware control).
- **MPX waterfall & scope** — the composite baseband (0–80 kHz), so the 19/38/57 kHz pilot, stereo and RDS subcarriers are visible and persist as they fade — a direct read of whether RDS is getting through. Same **lift** and **avg** controls, here aimed at coaxing a faint 57 kHz subcarrier up out of the noise on a marginal signal.
- **Live audio** — the tuned station's audio from SDRConnect, with a volume control, alongside the decode.
- **57k confidence** — an advisory estimate of how likely the current pass is to yield an ID. Built for the rapid fading of Sporadic-E: it accumulates evidence across an opening rather than reacting to each fade, so it stays meaningful through deep QSB, and reads "PI captured" / "name captured" once an ID is confirmed. It's an estimate, not a calibrated probability.
- **57k constellation** — the post-carrier symbol samples plotted live. A diffuse cloud is noise; two tight poles forming on the decision axis means coherent, recoverable RDS. It shows how close to decodable a signal is in a way a magnified spectrum cannot.
- **PI stability** — a live trace of how decisively one block-A value is winning the PI slot over an opening: its *dominance* (the lead over the nearest rival value) and the number of rival values that have themselves repeated. One value climbing and holding alone is a real ID converging; a low, contested trace with several rivals is noise. It makes the repetition-guard evidence visible — the same accumulation the decoder commits a PI on.

## Two knobs worth trying on stubborn signals

- **Bandwidth** — a slider (or type-in kHz field, 120–230 kHz) that sets the filter width around the tuned station. Narrowing it rejects adjacent-channel splatter and can rescue a weak station crowded by neighbours; widen it for clean, strong signals. It moves two filters in step: RDS Bridge's own decode filter (always), and — when SDRConnect reports hardware control is available — SDRConnect's front-end filter too, so narrowing is also audible in the streamed audio and shows on SDRConnect's own display. This works differently from a typical radio, where one filter governs the audio, the display and the decode together: RDS Bridge decodes from the full-bandwidth I/Q with its own filter, so the two are separate paths kept in step. Cyan **passband edges** on the RF waterfall show the current width and track the slider live; an **edges** toggle beside the slider hides them if you prefer a clean waterfall.
- **Error correction** — `≤2 bits` is a sound default; `≤3` recovers more at a slightly higher chance of a wrong fix; `off` gives the purest reads.

## DX log

Every fully-identified live catch is logged automatically with its frequency, PI, name, and the conditions it took to resolve it — SNR, pilot strength, data quality, whether error-correction was needed, and time-to-ID. Export to CSV for your records; the log persists between sessions in your browser.

## Interface & display

The interface auto-sizes to your screen. The scale control defaults to **Auto**, which reads your display and picks a size — 115% on a 4K / large desktop, 90% on 1440p, 75% on a 1080p screen or a 14–16″ laptop, 70% on smaller laptops — and shows the result (e.g. `Auto · 75%`). Fixed steps from 50% to 150% are there if you'd rather set it yourself; whatever you choose is remembered. A **high-contrast** toggle brightens the dim and faint labels for readability at small sizes, and a **fullscreen** toggle hides the browser chrome to give the waterfalls the whole screen. On a shorter screen the view scrolls so every panel — including the activity log at the foot — stays reachable.

Your waterfall setup persists between sessions too: the RF floor, ceiling, lift, averaging, zoom and view-mode, the MPX floor, lift and averaging, whether the RF waterfall was running, your bandwidth width, the PTY region (RoW / NA) and whether the passband edges are shown — all are remembered in the browser, so a dialled-in band comes back the way you left it. Everything here is stored locally; nothing leaves your machine.

A small **update indicator** sits beside the version number and lights up when a newer release is available on GitHub — checked once on load (cached for a few hours), and silent if you're offline. Clicking it opens that release. And the first time you open a new version, a brief **what's new** summary appears once, drawn straight from the changelog, so you can see what changed. Both are local to your browser and never touch the decode path.

## How it works (technical)

RDS rides a 57 kHz subcarrier (the third harmonic of the 19 kHz stereo pilot) at 1187.5 bits/s, differentially encoded and bi-phase modulated on a suppressed DBPSK carrier. Data is grouped into 26-bit blocks (16 information + 10 check), four to a group, each block carrying an offset word that drives synchronisation. The PI code sits in block A of every group, repeating ~11 times a second.

**The headline — NDA open-loop acquisition.** A conventional decoder closes a Costas carrier loop, a timing loop and a pilot PLL simultaneously from a cold start. On weak or fading signals these loops fight each other and the decoder *hangs* even though a decodable signal is present. RDS Bridge instead acquires open-loop and non-data-aided: it estimates symbol timing feed-forward with an Oerder–Meyr-style estimator (recovering the symbol-rate spectral line directly — no loop to hang), seeds the Costas carrier from it, and holds the Gardner timing feedback disabled until a coarse lock exists. Only then does it hand over to the closed loops for fine tracking. The result is fast, repeatable lock on signals where loop-based decoders stall — the core advance of the project.

Other elements: a Manchester-matched filter before timing recovery; a gear-shift loop strategy (wide during pull-in, narrow once locked); differential decoding to neutralise the suppressed carrier's 180° phase ambiguity; and syndrome-based block synchronisation with configurable burst error-correction over the (26,16) shortened cyclic code.

**PI repetition guard.** Block A carries the PI but, beyond its offset-word syndrome, has no message-level checksum — so a single burst-corrected read can pass as a valid-looking but wrong PI on a fading signal. A PI is therefore committed (to the display, DX log and confidence) only after it has been received more than once (default: one confirming repeat; tunable in advanced mode). A genuine PI repeats constantly; a spurious correction rarely lands twice on the same value.

**57k confidence, constellation & PI stability.** All three are pure observers of the decode path — they read its telemetry and symbol samples but never feed back into it. The confidence estimate deliberately ratchets accumulated evidence over an opening (peak SNR and pilot, pilot/sync duty, soft-PI/blind convergence, groups parsed) rather than reacting instantaneously, since under rapid fading the instant reading is meaningless; it banks a sticky result once a hard PI or name is confirmed. The constellation plots the carrier-recovered symbol samples directly: coherent RDS collapses to two poles on the decision axis while noise stays a diffuse cloud — the genuine discriminator between a real subcarrier and energy that merely sits at 57 kHz. The **PI-stability trace** works in the same spirit: because block A has no message-level checksum, confidence in a PI is really a matter of repetition and dominance over rivals accumulated across an opening, so the trace plots that dominance — the leading value's margin over its nearest competitor, normalised so it is unaffected by the vote counter's decay — over the pass, alongside a count of how many distinct values have themselves crossed the repetition threshold. A single value climbing to high dominance with no rivals is a genuine ID; several values trading the lead at low dominance is the signature of a false correction. It reads only the same block-A vote telemetry the repetition guard commits on — no extra tap, no decode-path change.

**Experimental paths (off by default, honest result).** Two further ideas — *soft-PI integration* (accumulating confidence-weighted PI evidence across sub-threshold groups) and *blind soft-PI* (a 104-phase bank that finds group phase without hard sync) — were built and measured against the baseline using the in-app test harness. On real signals both proved at best marginal: under controlled noise they tie the normal decoder and don't meaningfully extend the threshold. They're retained, off by default, as the foundation for future work. **The frozen baseline is the NDA decoder alone.**

## Advanced / developer mode

Add `?dev=1` to the URL, or click **advanced** in the header, to reveal developer tools: an offline IQ-file test harness (drag in a `.wav` recording, inject calibrated noise and fading, and auto-sweep the decode threshold in dB), the experimental soft/blind read-outs, the known-PI matcher, the PI repetition-guard setting, and confidence calibration logging (per-opening evidence and outcome, including peak PI dominance and rival count, exportable as CSV). None of it is needed for normal listening.

## Community

The **RDS-Bridge** Discord — linked in-app under *About* — is the place to discuss the app, swap DX reports, share ideas and request features: <https://discord.gg/dNuqXhVyPt>

## Licence

Released under the [MIT Licence](https://github.com/m0euk/RDS-Bridge/blob/main/LICENSE) — free to use, modify and redistribute, including commercially, provided the copyright and licence notice are retained. Provided "as is", without warranty.

## Author

Written by **Graeme Stoker, M0EUK**. Comments and feedback welcome: <graemest@gmail.com> Contributions via pull request or issue are welcome.
