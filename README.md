# RDS Bridge

**A single-file, browser-based FM RDS decoder.** Download one `index.html`, double-click it, and decode
RDS from an SDRplay receiver (via SDRConnect) or a networked SDR — no install, no server, no build step.

> Current release: **0.10.7-beta** · MIT licence · [rdsbridge.com](https://rdsbridge.com) ·
> [Discord](https://discord.gg/dNuqXhVyPt) · `info@rdsbridge.com`

RDS Bridge is a complete FM broadcast RDS decoder that runs entirely in your browser from a local file. It
speaks SDRConnect's own WebSocket API directly, so with an SDRplay receiver there's nothing else to install —
open the page, connect, and start decoding. It's built for DXers: confirmed-only decoding, a live RF
waterfall, a DX log, an automatic band scan, a **band map** that turns a whole IQ recording into a picture of
what was on air and when, and — new in 0.10.1 — **the hunt**, which works a marginal catch in a recording over
and over until it gives up its identity. It runs dark or light, whichever you prefer.

---

## Features

- **Full RDS decode** — PS name, RadioText, PI code, PTY, alternative frequencies (AF), clock time (CT),
  TP/TA and stereo flags, with a live 57 kHz confidence readout and a PI-stability display.
- **Confirmed-only, never guessed** — e.g. country of origin is shown only once the ECC actually decodes it,
  not inferred from the PI. Error-correction and channel-bandwidth controls let you chase weak DX without
  fabricating catches.
- **Band map** *(new in 0.10.0)* — turns a whole IQ recording into a frequency × time picture: time down the
  page, channels across, brightness showing how far each channel stood above its own noise floor at that
  moment. Click any cell to seek there, tune that channel and start playing. Your DX-log catches are drawn on
  it, so a bright column with no marker is a target you haven't identified yet. See [Band map](#band-map) below.
- **The hunt** *(new in 0.10.1)* — loop a few seconds of a marginal catch in a recording and watch the station
  assemble itself across the passes: the name filling in character by character, the PI with the count of
  passes that read it, programme type, country, alternative frequencies. Each pass is deliberately made
  *different* from the last — a nudged start, a different channel bandwidth — because replaying identical
  samples produces an identical answer and teaches you nothing. Every part of the picture is shown at the
  strength of its evidence, and nothing in it is fed back to the decoder. See [The hunt](#the-hunt) below.
- **DX Log view** *(new in 0.10.1)* — your catches full screen, from any mode, with the backup, restore and
  export controls.
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
- **Band scan** — sweep the band, or just a watch list, and log everything that decodes. Works on a live
  SDRConnect stream and *(new in 0.9.2)* in **MPX mode** when the helper can control your radio.
- **Antenna selector** — switch your receiver's antenna ports from the page, on SDRplay models that offer a
  choice.
- **SDRConnect comparison** — shows SDRConnect's own decoded PS/RT/PI side-by-side with the Bridge decode.
- **Light or dark** *(new in 0.10.3, panel framing improved in 0.10.4)* — a `theme` button in the top bar switches the whole interface and
  remembers your choice. Dark is the default. The RF waterfall, the MPX spectrogram and the band-map body stay
  dark in both themes: those are signal painted through a colour map, and a light colour map is harder to read,
  not easier. A `contrast` button lifts the dimmest labels further in either theme.
- **IQ recordings tune absolutely** *(improved in 0.10.2)* — the centre frequency is read from the recording's
  own metadata where the recorder wrote one, and from the filename otherwise, in kHz, MHz or GHz. Verified
  against SDRuno, HDSDR, SDR Console (including RF64 captures) and SDR#. Where an unfamiliar recorder's
  metadata cannot be confirmed, Bridge falls back to the filename rather than guessing.
- **Link diagnostics** *(new in 0.10.5)* — an optional switch in the advanced view, off by default, that
  records the outside conditions which can interrupt an SDR link: a monitor going to sleep or the window being
  covered (neither of which makes a browser tab "hidden"), single tasks blocking the page, the outbound socket
  backing up, and the machine changing power source. The counters run either way and appear in every saved
  log's header, with a one-line machine summary; the switch only decides whether each event is also written to
  the activity log as it happens.
- **Self-check** *(new in 0.9.4)* — one button, next to **help**, that tests your browser, confirms this copy
  is complete and unmodified, and proves the decoder works by generating a test signal and decoding it. It
  writes a plain-language report to your Downloads folder that you can read or email for support — nothing is
  ever sent automatically, and the report carries no file names, locations, serial numbers or log contents. It
  also explains the band scan, flags SDRConnect front-end overload, and warns if your browser will not save
  your DX log to disk. See [Self-check](#self-check) below.
- **Multiple sources** — a live SDRplay via SDRConnect; a **networked SDR** (SpyServer, rtl_tcp, or remote
  SDRConnect) through the companion helper; **MPX mode** for an external SDR's composite output; or an
  **IQ file** for offline decoding.
- **Adjustable views** — Compact, Essentials, **Map**, **DX Log**, **Pano**, Normal and Advanced layouts for anything from a
  glance to a full workbench. *Pano* *(new in 0.9.1)* is a band-watching view: the identification cards over
  a deep, screen-filling RF waterfall with an adjustable time-depth (max-hold) for spotting sporadic DX at a
  glance, plus audio and status chips.

---

## Self-check

*New in 0.9.4.* If RDS Bridge isn't behaving and you can't tell why, press **self-check** in the top-right
corner, next to **help**. It runs in a few seconds and answers the questions behind most support requests, in
plain language:

- **Is your browser supported?** It names the browser you are actually using — not always the one you think —
  and says plainly whether it is a supported Chromium browser.
- **Is this copy complete?** It compares the decoder inside your file against the published version, so a
  part-saved or edited copy is caught rather than mystifying you.
- **Is the decoder working?** It builds its own test signal — a made-up station with a known name and identity
  — and decodes it. If that passes, the decoder is fine and the problem is your radio, audio routing or
  signal. It also checks the opposite: given pure noise, it must report *nothing*, so it never invents a
  station.
- **What is connected?** For SDRConnect it reports the connection, radio model, sample rate, antennas and
  front-end overload; for the helper, the link and a reminder to keep helper and Bridge on the same version;
  for MPX, whether audio is actually arriving.
- **The band scan, explained.** Why your radio jumps to an odd frequency mid-scan, how many channels your
  skip-list and watch-list cover, and whether an over-wide filter could log a neighbour on the wrong channel.

The report saves to your **Downloads** folder as `rds-bridge-diagnostics-<date>.html`. **Nothing is sent
anywhere** — it is yours to read, ignore, or email to `info@rdsbridge.com`. It deliberately contains no file
names, folder names, locations, serial numbers or anything from your DX log.

---

## Requirements

- **A Chromium-based browser** — Chrome, Edge, or Brave. Safari and Firefox are **not** supported.
- **An SDR source**, most commonly an **SDRplay receiver** (any model except the original RSP1) running
  **SDRConnect 1.0.6 or later** with its WebSocket API enabled (port 5454). Other SDRs work via the
  [helper](#networked-sdrs--the-helper).
- That's it — RDS Bridge is one `index.html` you run locally. Nothing is installed and nothing is uploaded;
  it runs on your machine and talks only to your SDR.

---

## Quick start

1. Download **`index.html`** from the [Releases](https://github.com/m0euk/RDS-Bridge/releases) page.
2. Double-click it — it opens in your browser from `file://`. (Use a Chromium browser.)
3. Start **SDRConnect** with your SDRplay receiver and a device started, and enable its WebSocket API.
4. In RDS Bridge, press **Connect**, then **Start**. Tune by clicking the waterfall or typing a frequency,
   and watch the RDS decode.

Keep the downloaded `index.html` somewhere handy (bookmark the local file) and re-download to update.

---

## Band map

*New in 0.10.0.* Load an IQ recording in **IQ File** mode, choose the **map** view, and press **build**.

Time runs down the page and channels run across. Each cell shows how far that channel stood above **its own**
noise floor during that slice of time, so a fading band and a strong one both read sensibly — it is a
presence map, not a signal-strength meter, and the numbers are not comparable between recordings.

- **It samples; it does not read the whole file.** Each row is established from a handful of short windows,
  so even a very large capture maps in seconds rather than in the time it would take to play. A 66 GB,
  32-minute, 9 MHz capture built a 91-channel × 396-row map in about 1.4 seconds on an Apple Silicon Mac
  mini — a figure for that machine, not a promise about yours.
- **Click a cell to go there.** The recording seeks to that moment, tunes that channel, and starts playing
  with audio armed. The map drives the recording, so it is inert — and visibly dimmed — on any source other
  than IQ File.
- **Hover a cell to read it** *(new in 0.10.6)* — an outline marks the cell under the pointer and a chip
  gives its channel, time and level, with the PI and name if you have already caught it.
- **A playhead** marks the time you are at and the channel you are tuned to. It follows playback, and gets
  out of your way as soon as you scroll elsewhere to read the map.
- **Loop a section** with *loop start* / *loop end* / *play loop*, and work it with [the hunt](#the-hunt).
  The decoder restarts clean on every pass, deliberately: replaying identical samples must not be able to
  inflate the vote count that this project relies on to spot a fabricated PI.
- **Your catches are drawn on it** as blue rings, for catches made from that recording. Catches from another
  recording, or made live, carry no position in the file and are left off rather than placed at a guess.
- **The capture roll-off is marked, not trimmed.** Channels beyond the two faint lines are real and worth
  checking; they simply read low.

**Row length** is 5 s by default and can be set from 5 s to 5 minutes; a recording long enough to overrun the
canvas steps it up automatically. The map is **IQ File only** — it needs a whole recording on disk to sample
across.

---

## The hunt

*New in 0.10.1.* A marginal catch in a recording is usually a few seconds of audio that has to be attacked
repeatedly before it gives up a PI. Mark the stretch with *loop start* and *loop end*, press *play loop*, and
a **Hunt** strip appears above the waterfall and fills in as the passes go by.

**Every pass is made different from the last, on purpose.** Replaying identical samples through the decoder
produces a bit-for-bit identical answer — measured, not assumed — so a loop that changes nothing reports one
result over and over. Two things vary instead:

- **jitter each pass** *(on)* — each lap starts up to 400 ms, or 8 % of the section, later than the last, so
  the decoder meets the signal with different symbol timing and different block boundaries. The first lap is
  exactly the stretch you marked.
- **vary bandwidth** *(on)* — each lap takes the next of 160 / 180 / 205 / 140 / 225 kHz. A different filter is
  a different experiment on the same samples; the same filter is not. Your own setting is put back the moment
  the loop stops.

You can also change bandwidth, error correction, matched filter or sync mode while the loop runs. Each of
those rebuilds the decoder, so a mid-pass change used to throw the lap away; they now take effect at the top
of the next pass and the ledger records which setting produced which read.

**Reading the strip.** Each part of the picture is drawn at the strength of the evidence behind it:

| | means |
|---|---|
| **bright** | read on several passes, under **more than one** configuration |
| dim | repeated, but only ever under one configuration |
| faint dot | nothing read at that position yet |

That distinction is the point of the whole thing. Jitter varies the timing, but the noise in a recording is
frozen, so a mistake can repeat. In testing, a per-character majority over ten jittered passes at a single
bandwidth produced a character that **was not in the signal**, on two readings. So the picture counts passes
and configurations separately and shows you both, rather than collapsing them into one number.

**Logging what you find.** *log this catch* appears in the strip during looped playback, once a PI has been
read on at least two passes. It records the **strongest single pass's own conditions** — that pass's SNR,
pilot and error-correction figures, never an average of passes, because an average is a reading nobody took —
and writes the name from the bright characters only, leaving a dim one blank rather than guessing. The entry
is marked in the log, the CSV and the JSON backup as coming from a hunt, with the number of passes behind it,
so it can never later be mistaken for a single clean decode.

**Nothing in the hunt reaches the decoder, and nothing in it logs itself.** Automatic DX logging is unchanged
and still records only what one pass decoded on its own. The pass-by-pass ledger under the transport shows
each lap's own reading and the per-PI tally — *0xC202 in 7 of 9* — with the bandwidths that produced it.

---

## Band scan

New in 0.9.0. In the **Decoder** panel, pick a **Scan mode** and press **Scan band**:

- **Full band** — one sweep of the whole band, logging everything it can decode. Run it first to build up
  your DX log and local-station list.
- **DX watch** — sweeps the whole band on a loop, skipping your skip-list, empty channels and strong-local
  splatter, so it converges on genuinely new signals. The mode to leave running during an opening. A channel
  is only set aside once the scan has checked it twice and measured nothing, and *(since 0.10.5)* **a channel
  that shows a pilot lock is never set aside** — a carrier that didn't give up RDS this time is not evidence
  that it never will. Neither is anything already in your DX log. Every strike expires after fifteen minutes,
  so the set-aside list settles at a working size instead of growing until the whole band is written off; over
  a four-hour run on the development machine it held at about 30 of 206 channels. **Keep the window visible
  while it runs** — browsers slow a hidden tab to about one timer per minute and can freeze it entirely, which
  stalls the scan. Since 0.10.4 Bridge detects this, says so in the activity log, and pauses its dead-channel
  learning until timing recovers.
- **Watch list** — rapidly loops just the frequencies you choose (single freqs and ranges, e.g.
  `87.5-88.0 104.2`), for camping on the clear channels where Sporadic-E shows first.

The **skip list** (your locals) is built by ticking "skip" on DX-log rows, typing frequencies, or "＋ my
catches". Detection uses integrated channel power, and the channel step follows your **Spacing** setting — Auto
(region: 100 kHz, or 200 kHz on the odd tenths in North America) or a fixed 50 / 100 / 200 / 250 kHz, so the
scan can reach grids like Thailand's quarter-MHz stations. Every catch runs through the normal
decoder and PI commit guard — the scan only points the radio and watches, so it can't fabricate a station.
A non-verbose scan logs start, catches, a 30-second progress heartbeat, and stop; turn on **verbose scan
log** for a per-channel view with signal levels. Each sweep ends with a summary that accounts for every
channel it checked — how many were empty, how many were held because they showed a pilot lock, how many were
reheard and how many were newly logged. Where a sweep has no spectrum to work from — the waterfall
off, or windows coming round too fast for a baseline — the pre-skip switches itself off and every channel is
tuned and listened to, logged as `no baseline — checking`. That sweep is slow, and it is the correct
behaviour: since 0.10.4 the scan never skips a channel it hasn't measured, and since 0.10.5 it never sets one
aside on a reading it couldn't trust.

**If the link goes quiet.** If SDRConnect stops sending, the scan pauses rather than judging channels it
cannot measure — the status line says so, with the elapsed time — and picks up where it left off when the
data returns. Nothing is written off while it waits. See [Known issues](#known-issues).

---

## Networked SDRs — the helper

RDS Bridge can decode a receiver on your network — **SpyServer**, **rtl_tcp**, or a remote **SDRConnect** —
through a small optional companion program, `rds-bridge-helper`. It streams a narrowed IQ feed to the
browser (which can't open raw sockets or buffer a jittery Wi-Fi stream itself). The same helper can also
feed your SDR's tuned frequency into **MPX mode**, so those catches log by real frequency — and, *new in
0.9.2*, **tune that radio for you** when it can be controlled over CAT (SDR Console is the tested case). That
makes the frequency readout editable in MPX and enables the band scan there.

The helper is a single ~5 MB download for Windows, macOS and Linux with nothing to install. Full setup is
in **[`helper/README.md`](helper/README.md)**.

**The current helper is `0.9.2-beta`.** It is versioned separately from Bridge and changes far less often, so
the same helper build is attached to several Bridge releases in a row. **Take Bridge and the helper from the
latest release and they will always be a matched pair** — if the helper there is the one you already have,
there is nothing to download.

> **Keep the pair in step.** The *IQ stream format* has been versioned since Bridge 0.8.6 — a helper and a
> Bridge from either side of that change decode garbage rather than reporting an error — and from helper
> 0.9.2 an older helper refuses the tune instruction rather than acting on it. Both numbers name the release
> that introduced the change, not a version you should be running. To check what you have, run the helper
> with `-version`.

---

## Browser support

RDS Bridge uses Web Audio, Web Workers and WebSockets from a `file://` page, and targets **Chromium**
(Chrome, Edge, Brave). Safari and Firefox are not supported. There is nothing to install and no data leaves
your machine.

---

## Licence

**MIT** — see [`LICENSE`](LICENSE). RDS Bridge itself (`index.html`) contains no third-party code; the
helper binaries bundle a few open-source libraries, whose notices are in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) and are attached to every release alongside the binaries.

---

## Known issues

**SDRConnect link interruptions.** On some systems SDRConnect stops sending spectrum and property data over
the WebSocket while continuing to send IQ, with the connection still open; on others the connection closes
outright. Bridge detects this, pauses any running scan, judges no channel while it lasts and resumes when the
data returns — so a scan is delayed rather than corrupted.

The cause has not been identified. It has been seen on three different combinations of operating system,
browser and receiver, and in each case only restarting SDRConnect itself restored the streams; reconnecting
Bridge and restarting the device did not. Investigation is continuing with a standalone diagnostic tool that
removes the browser from the picture.

If you hit it, the activity log records what Bridge measured and what to check, and an export is very
welcome — on [Discord](https://discord.gg/dNuqXhVyPt) or at `info@rdsbridge.com`.

---

*RDS Bridge is maintained by Graeme (M0EUK). Questions, catches and bug reports welcome on
[Discord](https://discord.gg/dNuqXhVyPt) or at `info@rdsbridge.com`.*
