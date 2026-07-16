# RDS Bridge

A browser-based weak-signal **RDS decoder** built for FM DXing. It works four ways: **live** over [SDRConnect](https://www.sdrplay.com/sdrconnect/)'s WebSocket interface for real-time decoding and tuning; **live from a networked receiver** (SpyServer / rtl_tcp) through the optional **rds-bridge-helper** companion; **live from any SDR** via its **MPX / composite** output routed through a virtual audio cable; or **offline**, decoding recorded IQ `.wav` files from any SDR — SDRuno, SDR Console, SDR#, HDSDR and the rest. Either way it decodes the RDS data stream in your browser, with an acquisition front-end designed to lock weak, fading signals that conventional decoders miss.

**▶ Download [`index.html`](https://github.com/m0euk/RDS-Bridge/blob/main/index.html), save it, and open it in your browser.** It's a single self-contained file that runs entirely on your own machine — there's nothing to install.

---

## What it is

RDS Bridge takes the raw I/Q stream — live from SDRConnect, live from a networked receiver over SpyServer or rtl_tcp, or from a recorded IQ `.wav` made in any SDR software — and decodes RDS entirely in the browser (in a Web Worker — no server, no build step, one HTML file). It shows the station ID (PI), name (PS), programme type, RadioText, traffic flags, alternative frequencies and clock-time, alongside lock and signal-quality indicators tuned for weak-signal work.

Its distinguishing feature is an **NDA open-loop acquisition front-end** that locks weak and unstable FM signals from a cold start where conventional loop-based decoders hang.

It's also a self-contained **live monitor**: an RF band waterfall and an MPX composite waterfall, live audio from SDRConnect, **click-, wheel- and type-to-tune** straight from the band display, a **57k confidence** predictor that estimates how likely a fading station is to yield an ID this pass, and a live **57k constellation** that shows how close a signal is to decoding, and a **PI-stability** trace that shows how decisively one station ID is winning out as evidence accumulates. And it keeps a **DX log** of every catch, recording the conditions and what the decoder needed to resolve each one.

## Requirements

- A modern browser (Chrome, Edge, or Firefox).
- For **MPX Stream** (below): a desktop Chromium browser (Chrome or Edge), a virtual audio cable, and an SDR whose software can output the FM composite — all set to **192 kHz**.
- For **Network SDR** (below): the optional **[rds-bridge-helper](helper/README.md)** companion, plus a SpyServer or rtl_tcp server you run yourself. Keep the helper and RDS Bridge on the same version.

## Sources: live SDRConnect, a networked SDR, MPX from any SDR, or a recorded IQ file

RDS Bridge can decode a **live SDRConnect** connection (the default), a **networked receiver** over
SpyServer or rtl_tcp, an **MPX composite** stream, or a **recorded IQ `.wav` file**. Pick the source
at the top of the Connection panel.

In **IQ File** mode you load a recording and work it much like a live capture: play/pause and a
scrubber move you to any point in the file, the ◂ / ▸ buttons jump ±10 s / ±60 s, and both the MPX
and RF waterfalls render. You can retune the decoded channel within the recording by clicking the
RF waterfall, typing a frequency into the main readout, or using the step buttons — and the readout
shows the tuned station. Playback is always real time (1×); the transport is for *positioning*, not
fast-forward. The recording's start time is read from the file (SDR Console's XML metadata, SDRuno / SpectraVue
and Broadcast-Wave timestamps, or a date in the filename), and the transport shows the exact **UTC
time at the playhead** as you scrub.

Recordings must be **2-channel** WAV (plain RIFF or RF64 / BW64), either **16-bit signed PCM** or
**32-bit IEEE float**, sampled at **≥ ~120 kHz** so the 57 kHz RDS subcarrier is present. SDR Console
records 32-bit float by default and now loads as-is (tested with an Elad FDM-S2); SDR++ works either
way; SDR# / SatDump export 16-bit. Float recordings are level-matched automatically on load, so there
is nothing to set. **Absolute tuning** — real MHz on the readout, with click- and
type-to-tune within the recording — works whenever the file carries its centre frequency: SDR
Console embeds it in the WAV metadata, while SDRuno and SDRConnect put it in the filename (a
`100675000Hz` or `100.675MHz` token). Without it, the recording still decodes at its own centre.

**Audio plays in IQ File mode** (0.5.3). The tuned station's audio comes through as you work a
recording, just like live SDRConnect audio — mono, with the 50/75 µs de-emphasis following the
region toggle. It works on **wideband recordings** too: the tuned station is mixed down and narrowed before the
decoder, while the RF waterfall still spans the full recorded bandwidth for tuning. (Since 0.5.4 the
file RF waterfall scrolls at a steady rate regardless of the file's sample rate, and renders at finer
resolution — so high-rate captures no longer race past to read.)

**How wide can a recording be? There is no fixed limit, and no rate is claimed** — a sample-rate promise
is a promise about *your* machine, and it would be a lie on some and an undersell on others. The rule
instead: **RDS Bridge plays as fast as your machine can narrow the signal. If it can't keep up it tells
you — and RDS decoding is unaffected either way.** Narrowing a wide capture down to the channel is the
expensive part, and it is what runs out first; when playback falls behind, the file readout shows the
measured speed (e.g. `0.41× — audio stutters`). Only the *audio* needs real time. The decoder does not:
a user whose audio was badly stuttering at 0.36× held a rock-solid PI at 99% dominance the whole way
through. So a recording too wide for your machine still decodes correctly — it just doesn't sound like
it's working.

Rough arithmetic if you want to size a machine, offered as a guide and not a promise: narrowing costs
roughly **14 MMAC/s per Msps** of capture (an 8-year-old i5 manages ~130 MMAC/s single-threaded in the
browser; an M-series Mac, far more). A file **bigger than your RAM** adds a second, independent ceiling —
your disk must sustain about **4 MB/s per Msps** (a 24.576 Msps capture needs ~94 MB/s held indefinitely,
which most single drives will not do). Below RAM size, the operating system caches the file and the disk
stops mattering. Making the narrowing faster is active work — see the changelog.

### MPX Stream — decode RDS from any SDR

The third source, **MPX Stream**, takes a finished FM **composite (stereo multiplex)** signal as
audio, so RDS Bridge can decode RDS from *any* SDR or SDR software that can output composite — not
only SDRplay over SDRConnect. Route your SDR's composite/MPX output to a **virtual audio cable**
(VB-Cable or VAC on Windows, BlackHole on macOS), choose **MPX Stream**, pick that input, and press
**Start MPX**. Tuning and the RF spectrum stay in your SDR software; RDS Bridge decodes the composite
it's sent — showing PS, PI, PTY, RadioText, clock and AF, with the composite spectrum and 57k
constellation live. When you retune, RDS Bridge detects the break in the composite (the pilot drops and
recovers) and clears the previous station automatically — promptly, and even if the new station shares the
old one's PI (there's also a manual **reset** button).

The composite path must run at **192 kHz** end to end. The RDS subcarrier sits at 57 kHz, so a lower
rate — a virtual cable left at its 48 kHz default is the usual culprit — loses it: the pilot and the
stereo indicator still work, but nothing decodes. Set **both** the cable and your SDR's composite
output to 192000 Hz; RDS Bridge reads the incoming rate and tells you if it's too low. **Verified with
SDR Console's composite output feeding an Airspy HF+ Discovery** — other SDRs, other software and other
virtual cables use the same standard audio path and should work, but are not yet confirmed.

MPX Stream needs a desktop **Chromium** browser (Chrome or Edge) to capture audio, and works from a
double-clicked local file. Two conveniences — selecting your cable *by name*, and the browser
*remembering* microphone permission between sessions — are only available when the same single file is
served over `http://localhost`, because browsers restrict them for local files (a browser policy, not
an app limitation). An **offline MPX test** under the Advanced view plays a mono composite `.wav`
straight through the decoder with no radio attached.

In MPX mode, tuning lives in your SDR, so RDS Bridge has no dial frequency of its own — catches log as
`MPX`. An optional companion program, **[rds-bridge-helper](helper/README.md)**, reads your SDR's tuned
frequency and feeds it to RDS Bridge over a local link, so MPX catches log by their **real frequency** and
it shows in the readout, following along as you retune. Run the helper and a setup page opens in your
browser — pick your source (SDR Console over CAT, SDR++ over the network, and so on), then connect RDS
Bridge from the **Frequency helper** row. It's one-way and entirely optional; with no helper linked, MPX
works exactly as above.

### Network SDR — decode a networked receiver, no other SDR software

The fourth source, **Network SDR**, decodes a live IQ stream from a receiver on your network — with no
other SDR application running at all. RDS Bridge tunes it, decodes it and plays its audio in the browser.

It needs the optional **[rds-bridge-helper](helper/README.md)** companion, and that is not a design
choice we made: a browser cannot open a raw TCP socket, and both supported servers speak raw TCP, so
something has to sit in the middle. The helper reads the radio, narrows the IQ to an RDS-appropriate
rate (which keeps the network traffic about 12× lighter than shipping the full stream) and hands it to
RDS Bridge. Run the helper, pick your source and address on the setup page that opens, then choose
**Network SDR** in RDS Bridge and connect to it.

- **SpyServer** (port 5555) — Airspy R2 / Mini / HF+ / Discovery, and RTL-SDR dongles fronted by SpyServer.
  **This is the tested path**, verified end to end against an Airspy HF+ Discovery.
- **rtl_tcp** (port 1234) — RTL-SDR dongles direct. ⚠ **Experimental.** The reader is written and
  unit-tested against the protocol but has **never been run against a real dongle** — nobody here owns
  one. It may well work; it isn't a claim, and if you try it, please report what happens. If you have an
  RTL-SDR and want the tested route today, run it behind SpyServer.

The radio can be on this machine (`localhost`) or another box on the LAN — a Pi in the loft with the
antenna, your browser downstairs. The helper always runs next to your browser and connects out to the
radio. You still install and run rtl_tcp or spyserver yourself; a web page can't launch them for you.

**Tuning:** when the server allows control, tune from the main frequency readout or the panel's Tune To
box — a small move shifts within the captured span instantly, a larger jump retunes the radio itself.
If the server refuses control (SpyServer's `allow_control=0`, or another client got there first), set
the frequency in your SDR software and RDS Bridge follows it.

**RF waterfall:** with a SpyServer source the helper relays the server's own display spectrum and RDS
Bridge paints it as a full RF waterfall — click, scroll and Ctrl-zoom it like any other. It spans the
radio's full width (768 kHz on an Airspy HF+ — that radio's silicon ceiling, not ours), which is wider
than the channel being decoded, so a click outside the decoded span retunes the radio. rtl_tcp offers no
server-side spectrum, so it decodes without a waterfall.

⚠ **Keep the helper and RDS Bridge on the same version.** From 0.8.6 the IQ frames are tagged, and a
mismatched pair produces garbled audio and junk decode rather than a clean error. If a working setup
suddenly decodes nonsense, check the pair before anything else.

**What's next:** SDRConnect's own remote/headless server on the LAN. RDS Bridge already speaks
SDRConnect's WebSocket API — it's how the live SDRConnect source has always worked — so pointing it at a
server on another machine may need little more than a different address. That is **not supported yet**
and isn't promised: a browser security rule (Private Network Access) governs whether a locally-opened
page may reach a service on another machine, and it hasn't been tested. If it turns out not to work, the
fallback is an SDRConnect reader inside the helper, alongside SpyServer and rtl_tcp.

## Running it

RDS Bridge must be **run from a local copy**: download `index.html`, save it to your computer, and open it in your browser (double-click it, or use File ▸ Open). Then click **Connect**.
> **Why does it have to run locally?** The app talks to SDRConnect through a WebSocket on your own machine (`ws://127.0.0.1:5454`). For security, browsers block a web page loaded from a remote site (such as GitHub Pages) from opening a connection to a local service — so a hosted copy cannot reach SDRConnect. Running the file from your own computer avoids this completely. Because it's a single self-contained file, "download and open" is all there is to it.

*(Advanced: serving the file from a local web server, e.g. `http://localhost`, also works — the restriction only affects pages loaded from a remote origin.)*

## Quick start

1. In SDRConnect, enable the remote/WebSocket server and tune your FM station.
2. In RDS Bridge: **Connect → choose your device → Start.**
3. Within a second or two of a lock you'll see PI, the station name, and the rest fill in.

## Reading the display

*Hover any indicator or control for a tooltip explaining what it is and how to read it — the panels below are covered end to end.*

- **PI** — the station's unique ID code (hex), shown as a large headline directly beneath the station name (for DX the ID is almost as important as the name at a glance). The hardiest field; it locks first, often before anything else is readable. A PI is committed only once received more than once (a repetition guard against false single-read decodes).
- **PS** — the 8-character station name. Needs more signal than PI, so on a weak catch you may see PI long before the name finishes assembling.
- **PTY / RadioText / TP / TA / Stereo / AF / Clock** — programme type, scrolling text, traffic flags, stereo pilot, alternative frequencies, and broadcast time. A **RoW / NA** toggle in the header switches the programme-type labels between the European (RDS / EN 50067) and North American (RBDS / NRSC-4) tables — the on-air value is identical, only the label set differs, so it's a manual choice with no auto-detect.
- **Lock & quality** — *Sync* (block alignment), *Pilot* (a strong steady 19 kHz pilot means a genuinely coherent signal is present), *Data Q* (how clean the bitstream is), *SNR*.

## Live monitoring

- **RF waterfall** — the captured band as a scrolling spectrum, with an MHz scale and a green marker on the channel being decoded. Readability controls let you match the band: **floor** and **ceil** set where the palette starts (black) and tops out (white), **lift** is a weak-signal stretch that brightens faint stations just above the floor without washing out the strong ones, and **avg** is frame averaging that smooths the noise floor. **Zoom** (1–8×, from the dropdown or by holding **Ctrl** and scrolling the mouse wheel over the waterfall) magnifies a crowded stretch, with a **follow / free** view mode — follow recentres on the frequency you tune, free keeps the view fixed and lets you drag to pan. **Tuning — three ways to move:** *click* the waterfall (or its scale) to retune SDRConnect's VFO there; *scroll the mouse wheel* over the waterfall to step up and down the band (wheel-down steps the frequency down, matching SDRConnect; hold **Shift** while scrolling for coarse 1 MHz steps); or *type a frequency straight into the readout* above the waterfall — click it, enter the frequency in MHz and press Enter. As in most FM DX software the decimal point is optional, so `875` tunes 87.5 and `1041` tunes 104.1; it's free-range, covering the OIRT band (65–74 MHz) and beyond as well as 87.5–108 (use a decimal point for out-of-band frequencies), and Esc cancels an edit. **Snap** rounds click and wheel steps to a frequency grid (default 100 kHz) to match your tuning step. If a typed frequency falls outside the captured span, the whole capture recentres automatically so it comes into view. **Step buttons** beside the readout — −1 MHz / −200 kHz / +200 kHz / +1 MHz — jump the tuning by a fixed amount in one click, recentring the capture the same way if a step lands outside the span. (Tuning needs SDRConnect hardware control.) A **centre** button (⌖) recentres the whole capture on the station you're tuned to, bringing a catch near the edge of the span into the middle where the band is cleanest — your tuning and RDS lock are kept (needs SDRConnect hardware control).
- **MPX waterfall & scope** — the composite baseband (0–80 kHz), so the 19/38/57 kHz pilot, stereo and RDS subcarriers are visible and persist as they fade — a direct read of whether RDS is getting through. Same **lift** and **avg** controls, here aimed at coaxing a faint 57 kHz subcarrier up out of the noise on a marginal signal.
- **Live audio** — the tuned station's audio from SDRConnect, with a volume control, alongside the decode.
- **57k confidence** — an advisory estimate of how likely the current pass is to yield an ID. Built for the rapid fading of Sporadic-E: it accumulates evidence across an opening rather than reacting to each fade, so it stays meaningful through deep QSB, and reads "PI captured" / "name captured" once an ID is confirmed. It's an estimate, not a calibrated probability.
- **57k constellation** — the post-carrier symbol samples plotted live. A diffuse cloud is noise; two tight poles forming on the decision axis means coherent, recoverable RDS. It shows how close to decodable a signal is in a way a magnified spectrum cannot.
- **PI stability** — a live trace of how decisively one block-A value is winning the PI slot over an opening: its *dominance* (the lead over the nearest rival value) and the number of rival values that have themselves repeated. One value climbing and holding alone is a real ID converging; a low, contested trace with several rivals is noise. It makes the repetition-guard evidence visible — the same accumulation the decoder commits a PI on.

## Two knobs worth trying on stubborn signals

- **Bandwidth** — a slider (or type-in kHz field, 120–230 kHz) that sets the filter width around the tuned station. It defaults to **200 kHz**, which suits weak signals: RDS Bridge decodes from the FM-demodulated composite, so giving the demodulator the full carrier rather than clipping it recovers a marginal station that a narrower filter would starve of signal. Narrow it to reject adjacent-channel splatter when a neighbouring station is crowding the catch. (A bandwidth you set is remembered between sessions.) It moves two filters in step: RDS Bridge's own decode filter (always), and — when SDRConnect reports hardware control is available — SDRConnect's front-end filter too, so narrowing is also audible in the streamed audio and shows on SDRConnect's own display. This works differently from a typical radio, where one filter governs the audio, the display and the decode together: RDS Bridge decodes from the full-bandwidth I/Q with its own filter, so the two are separate paths kept in step. Cyan **passband edges** on the RF waterfall show the current width and track the slider live; an **edges** toggle beside the slider hides them if you prefer a clean waterfall.
- **Error correction** — `≤2 bits` is a sound default; `≤3` recovers more at a slightly higher chance of a wrong fix; `off` gives the purest reads.

## DX log

Every fully-identified catch is logged automatically — from live SDRConnect, from a played-back IQ recording, and from an MPX composite — with its frequency, PI, name, and the conditions it took to resolve it: SNR, pilot strength, data quality, whether error-correction was needed, and time-to-ID. MPX has no dial frequency inside RDS Bridge (tuning stays in your SDR), so MPX catches are logged by PI and shown with **MPX** in the frequency column, one row per station. Export to CSV for your records; the log persists between sessions in your browser.

## Interface & display

A **view selector** in the header sets how much of the interface is shown, with four settings: **compact** collapses everything to a single-line status bar (PS · frequency · RadioText · quality); **essentials** shows just the identification — Programme Service, RadioText, PI-stability with a compact 57k constellation beside it, and the 57k confidence strip — hiding the controls, both waterfalls, the scope and the logs, for watching a marginal catch resolve or working on a small screen; **normal** is the full decoder; and **advanced** additionally reveals the developer/experimental tools. Normal and advanced are remembered between sessions; compact and essentials are per-session monitoring views, so reopening the app returns you to your last full view — the connect controls are always there on load. From compact, the **Expand** button returns you to whichever view you were last in.

The interface also auto-sizes to your screen. The scale control defaults to **Auto**, which reads your display and picks a size — 115% on a 4K / large desktop, 90% on 1440p, 75% on a 1080p screen or a 14–16″ laptop, 70% on smaller laptops — and shows the result (e.g. `Auto · 75%`). Fixed steps from 50% to 150% are there if you'd rather set it yourself; whatever you choose is remembered. A **high-contrast** toggle brightens the dim and faint labels for readability at small sizes, and a **fullscreen** toggle hides the browser chrome to give the waterfalls the whole screen. On a shorter screen the view scrolls so every panel — including the activity log at the foot — stays reachable.

Your waterfall setup persists between sessions too: the RF floor, ceiling, lift, averaging, zoom and view-mode, the MPX floor, lift and averaging, whether the RF waterfall was running, your bandwidth width, the PTY region (RoW / NA), whether the passband edges are shown, your full view (normal / advanced), and the advanced **Decoder settings** (error correction, matched filter, sync, acquisition and the PI guard) — all are remembered in the browser, so a dialled-in band comes back the way you left it. Everything here is stored locally; nothing leaves your machine.

A small **update indicator** sits beside the version number and lights up when a newer release is available on GitHub — checked once on load (cached for a few hours), and silent if you're offline. Clicking it opens that release. And the first time you open a new version, a brief **what's new** summary appears once, drawn straight from the changelog, so you can see what changed. Both are local to your browser and never touch the decode path.

## How it works (technical)

RDS rides a 57 kHz subcarrier (the third harmonic of the 19 kHz stereo pilot) at 1187.5 bits/s, differentially encoded and bi-phase modulated on a suppressed DBPSK carrier. Data is grouped into 26-bit blocks (16 information + 10 check), four to a group, each block carrying an offset word that drives synchronisation. The PI code sits in block A of every group, repeating ~11 times a second.

**The headline — NDA open-loop acquisition.** A conventional decoder closes a Costas carrier loop, a timing loop and a pilot PLL simultaneously from a cold start. On weak or fading signals these loops fight each other and the decoder *hangs* even though a decodable signal is present. RDS Bridge instead acquires open-loop and non-data-aided: it estimates symbol timing feed-forward with an Oerder–Meyr-style estimator (recovering the symbol-rate spectral line directly — no loop to hang), seeds the Costas carrier from it, and holds the Gardner timing feedback disabled until a coarse lock exists. Only then does it hand over to the closed loops for fine tracking. The result is fast, repeatable lock on signals where loop-based decoders stall — the core advance of the project.

Other elements: a Manchester-matched filter before timing recovery; a gear-shift loop strategy (wide during pull-in, narrow once locked); differential decoding to neutralise the suppressed carrier's 180° phase ambiguity; and syndrome-based block synchronisation with configurable burst error-correction over the (26,16) shortened cyclic code.

**PI repetition guard.** Block A carries the PI but, beyond its offset-word syndrome, has no message-level checksum — so a single burst-corrected read can pass as a valid-looking but wrong PI on a fading signal. A PI is therefore committed (to the display, DX log and confidence) only after it has been received more than once (default: one confirming repeat; tunable in advanced mode). A genuine PI repeats constantly; a spurious correction rarely lands twice on the same value.

**57k confidence, constellation & PI stability.** All three are pure observers of the decode path — they read its telemetry and symbol samples but never feed back into it. The confidence estimate deliberately ratchets accumulated evidence over an opening (peak SNR and pilot, pilot/sync duty, soft-PI/blind convergence, groups parsed) rather than reacting instantaneously, since under rapid fading the instant reading is meaningless; it banks a sticky result once a hard PI or name is confirmed. The constellation plots the carrier-recovered symbol samples directly: coherent RDS collapses to two poles on the decision axis while noise stays a diffuse cloud — the genuine discriminator between a real subcarrier and energy that merely sits at 57 kHz. The **PI-stability trace** works in the same spirit: because block A has no message-level checksum, confidence in a PI is really a matter of repetition and dominance over rivals accumulated across an opening, so the trace plots that dominance — the leading value's margin over its nearest competitor, normalised so it is unaffected by the vote counter's decay — over the pass, alongside a count of how many distinct values have themselves crossed the repetition threshold. A single value climbing to high dominance with no rivals is a genuine ID; several values trading the lead at low dominance is the signature of a false correction. It reads only the same block-A vote telemetry the repetition guard commits on — no extra tap, no decode-path change.

**Experimental paths (off by default, honest result).** Two further ideas — *soft-PI integration* (accumulating confidence-weighted PI evidence across sub-threshold groups) and *blind soft-PI* (a 104-phase bank that finds group phase without hard sync) — were built and measured against the baseline using the in-app test harness. On real signals both proved at best marginal: under controlled noise they tie the normal decoder and don't meaningfully extend the threshold. They're retained, off by default, as the foundation for future work. **The frozen baseline is the NDA decoder alone.**

## Advanced / developer mode

Add `?dev=1` to the URL, or set the header **view selector** to **advanced**, to reveal developer tools: an offline IQ-file test harness (drag in a `.wav` recording, inject calibrated noise and fading, and auto-sweep the decode threshold in dB), the experimental soft/blind read-outs, the known-PI matcher, the PI repetition-guard setting, and confidence calibration logging (per-opening evidence and outcome, including peak PI dominance and rival count, exportable as CSV). None of it is needed for normal listening.

## Community

The **RDS-Bridge** Discord — linked in-app under *About* — is the place to discuss the app, swap DX reports, share ideas and request features: <https://discord.gg/dNuqXhVyPt>

## Licence

Released under the [MIT Licence](https://github.com/m0euk/RDS-Bridge/blob/main/LICENSE) — free to use, modify and redistribute, including commercially, provided the copyright and licence notice are retained. Provided "as is", without warranty.

## Author

Written by **Graeme Stoker, M0EUK**. Comments and feedback welcome: <graemest@gmail.com> Contributions via pull request or issue are welcome.
