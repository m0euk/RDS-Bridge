# Feeding RDS Bridge from your own app — integration guide

**Audience:** developers of an SDR or IQ application who want RDS Bridge to decode from their app.
**Normative contract:** [`PROTOCOL-generic-iq.md`](./PROTOCOL-generic-iq.md) (`rds-bridge-iq/1`). Where this guide
and that spec disagree, **the spec wins** — this document is the friendly on-ramp, not the law.
**Reference implementation:** the bundled Go helper in [`helper/`](./helper/) — in particular `iqlane.go`
(framing + control) and `ws.go` (the minimal WebSocket server). If in doubt, read what the helper does.
**Conformance test:** `helper/protocol_test.go` pins the wire bytes; run it in your own head as you build.

---

## 1. The one thing to get straight first

**Bridge is the WebSocket *client*. Your app is the *server*.**

This trips everyone up, so it comes first. You do not connect *to* Bridge. You stand up a WebSocket server;
Bridge opens `ws://your-host:port/` and connects to *you*. Then your app talks first: it announces what it is,
describes the stream, and starts pushing samples. Bridge listens and decodes.

If you were expecting to POST IQ at an endpoint Bridge exposes, stop — there isn't one. Invert the picture:
you are the radio, Bridge is the receiver plugging into you.

```
  ┌────────────────────┐         ws://host:port/          ┌──────────────────┐
  │  YOUR APP (server)  │  ◀────  Bridge connects  ─────  │  RDS Bridge      │
  │  - hosts WebSocket  │                                  │  (browser, the   │
  │  - sends hello      │  ────  JSON control frames  ──▶  │   ws CLIENT)     │
  │  - sends stream     │  ────  binary sample frames ──▶  │                  │
  │  - streams IQ       │  ◀────  optional control    ───  │                  │
  └────────────────────┘                                  └──────────────────┘
```

### Two ways to drive Bridge — pick your mode

| You have…                                   | Use mode   | You send                                   |
|---------------------------------------------|------------|--------------------------------------------|
| A stream of IQ samples (a real SDR feed)    | `iq16`     | JSON + binary Int16 IQ frames              |
| Only the *tuned frequency* (a CAT/rig link) | `meta`     | JSON only — audio reaches Bridge elsewhere |
| An MPX/composite baseband stream            | `composite`| **reserved**, not yet implemented          |

Most integrators want **`iq16`**: you have IQ, you want Bridge to decode it. That's the main path below.
`meta` is a thin sidecar for the case where the audio already reaches Bridge by another route (e.g. a virtual
audio cable carrying MPX) and you only need to tell Bridge *what frequency* it's listening to, so catches get
labelled and logged correctly.

---

## 2. Transport rules

- **Server-side WebSocket**, RFC 6455. The helper implements one in ~120 lines of Go stdlib (`ws.go`) if you
  need a template, but any WebSocket library will do.
- Bridge sets `binaryType = "arraybuffer"`. Send binary as binary opcode (`0x2`), text as text opcode (`0x1`).
- **Server→client frames are unmasked; client→server frames are masked** — that's just RFC 6455, and any
  compliant library handles it. Bridge (the client) will mask its uplink; you must unmask it.
- One JSON object per text frame. One sample block per binary frame.
- Endpoint path is **not** significant — Bridge connects to the root (`/`). The helper serves the config page
  on a plain GET to the same port and upgrades to the protocol only when it sees a WebSocket `Upgrade` header,
  so a single port does both. You can do the same or keep them separate; Bridge only cares that the URL it's
  pointed at speaks the protocol.
- **`ws://` for localhost/LAN.** `wss://` is allowed if you terminate TLS, but see §9 — there's no auth here,
  so this stays on trusted networks.

---

## 3. The handshake — what happens, in order (`iq16`)

1. **Bridge connects.** It *may* send an optional `hello` ack; you must not wait for it.
2. **You send `hello`** — who you are, whether you're live, whether you accept control.
3. **You send `stream`** — mode, sample rate, centre/VFO frequency.
4. **You start sending binary `iq16` frames** — continuously.
5. **You send a `tune` frame** whenever the user retunes in *your* app, so Bridge follows.

That's the whole protocol. Everything else is detail.

### 3.1 `hello` (you → Bridge, first message)

```json
{
  "kind": "hello",
  "protocol": "rds-bridge-iq/1",
  "source": "my-sdr-app 2.1",
  "live": true,
  "controllable": false
}
```

- `protocol` **must** be `rds-bridge-iq/1`. Bridge refuses a major version it doesn't implement (§8).
- `live: true` for a real-time radio; `false` for finite/seekable file playback. It changes how Bridge treats
  frequency changes — a live source's move is a *station change* (log it, re-acquire); a file's is a *seek*.
- `controllable: false` (or omit it) if you won't accept tune commands from Bridge. **This is the recommended
  default** — one-way, source→Bridge. Only set `true` if you genuinely want Bridge to drive your tuner (§7).

### 3.2 `stream` (you → Bridge, before any samples)

```json
{
  "kind": "stream",
  "mode": "iq16",
  "sample_rate": 250000,
  "centre_hz": 98000000,
  "vfo_hz": 98000000
}
```

- `sample_rate` — samples/second of your IQ. Two floors matter: **≥ ~120 kHz** or the 57 kHz RDS subcarrier
  isn't in your passband at all, and **≥ 200 kHz** if you want the channel bandwidth marginal stations need to
  commit a PI. **Decimate at the source is the recommended path** — narrow to an RDS-appropriate rate (the
  helper uses ~250–384 kHz) so Bridge stays on its validated direct decode path and the wire stays ~12× lighter.
  Bridge *will* engage its downconvert worker for a wide stream (exactly as its file path does, so you *can*
  hand it a wide capture and let it downconvert), but there's no reason to make it work harder than it needs to.
- `centre_hz` — the capture centre (your LO). The IQ is centred here.
- `vfo_hz` — the station Bridge should decode. Bridge decodes at offset `vfo_hz − centre_hz`.
  - **The centre/VFO split is the useful bit:** stream a *wide* capture (`centre_hz` in the middle of it) and
    point `vfo_hz` at one station inside it — Bridge decodes that station off-centre. The helper keeps life
    simple by centring the capture on the station (so it sends `vfo_hz == centre_hz`), but you don't have to.
- **`format`** — optional for `iq16`, because the layout is fixed (signed 16-bit, interleaved I then Q,
  little-endian, 2-byte frame header). The spec shows it explicitly; the helper omits it and relies on the
  fixed default. Include it if you like being explicit:

  ```json
  "format": { "sample": "int16", "layout": "interleaved-iq", "endian": "little", "header_bytes": 2 }
  ```

For `mode: "meta"`, drop `sample_rate` and `format` entirely and send only `vfo_hz` (and `centre_hz` if you
have it).

### 3.3 `tune` (you → Bridge, on every tuning change)

Push your tuning state to Bridge whenever it moves (this is "VFO-follow"):

```json
{ "kind": "tune", "centre_hz": 98000000, "vfo_hz": 98500000 }
```

Bridge reacts the same way it does on its native SDRConnect path:

- **Small move** (≤ ~50 kHz) → it nudges the decode mixer, *no reset*, lock held.
- **Big move** (> ~50 kHz) → treated as a genuine station change: it resets the decode accumulators and clears
  the RDS display, then re-acquires.
- **Recentre** (`centre_hz` moves, `vfo_hz` unchanged) → the capture re-framed around the same station; Bridge
  holds the RDS lock because the *tuned* frequency didn't change.

### 3.4 `meta` (you → Bridge, `meta` mode frequency updates)

For `mode: "meta"` sources only — the frequency sidecar:

```json
{ "kind": "meta", "vfo_hz": 98500000 }
```

Bridge uses this **only** to label and log the catch. It doesn't feed the decoder, because in `meta` mode the
samples are arriving some other way.

### 3.5 `bye` (either direction, optional)

```json
{ "kind": "bye" }
```

A politeness. Bridge also handles a bare socket close, and so should you. **Do not assume `bye` arrives before
`onclose`** — async close ordering is a known hazard; write your teardown so a socket that just vanishes is
handled cleanly.

---

## 4. Binary sample frames

Every binary frame is a **2-byte little-endian type tag** followed by the payload:

```
byte 0..1   uint16 LE   frame_type
byte 2..N               payload
```

In practice the tag is written as `[type_byte, 0x00]` (the reference `taggedFrame` sets byte 1 to zero), so:

| `frame_type` | Bytes  | Payload                                   | Status               |
|--------------|--------|-------------------------------------------|----------------------|
| `0x0002`     | `02 00`| Int16 interleaved I/Q, little-endian      | **iq16 — shipping**  |
| `0x0003`     | `03 00`| UInt8 display-FFT bins                     | **FFT — shipping (0.8.6)** |
| `0x0006`     | `06 00`| Float32 mono MPX composite                | composite — reserved |

> ⚠ **Do not invent your own tag numbers, and never repurpose these.** `iq16` is `0x0002` because the spec
> says so — an earlier candidate shipped it as `0x0001` and would have silently dropped every spec-conformant
> third-party source. New types are additive only (§8).

### 4.1 `iq16` payload (`0x0002`)

From byte 2 onward: signed 16-bit integers, **interleaved I, Q, I, Q, …**, little-endian. Complex-sample count
is `(byteLength − 2) / 4`. This is byte-for-byte what Bridge's decode worker reads (`Int16Array(buf, 2)`) — which
is exactly why feeding Bridge needs no change to its decode core.

- Full-scale is **±32767**. If your native samples are Float32 in the ±1 range, scale to Int16 before sending.
  Don't assume Bridge will normalise — it reads your Int16 as-is.
- **Frame size is your choice, but don't design for a smooth 10 ms cadence.** The reference helper emits
  ~100 ms of IQ per frame and it's comfortable. The transport is TCP, so frames can't be lost without the
  connection failing — no sequence counter is needed — but delivery is **bursty**: gaps of ~95 ms source-side
  and up to ~280 ms browser-side have been measured, with zero sample loss. **Size your buffers for ~0.5 s of
  burst** rather than assuming even spacing.

**Byte-level example** — one frame carrying two complex samples `(I=1, Q=-1), (I=2, Q=-2)`:

```
02 00        frame_type 0x0002 (iq16)
01 00        I = 1     (int16 LE)
FF FF        Q = -1
02 00        I = 2
FE FF        Q = -2
```

### 4.2 FFT display frame (`0x0003`) — optional waterfall

If your app can produce a wideband display FFT, you can drive Bridge's RF waterfall. This is **optional** and
**display-only** — it has nothing to do with decoding; skip it entirely and Bridge just hides the waterfall.

- Announce the geometry in your `stream` frame with two extra fields:

  ```json
  { "kind": "stream", "mode": "iq16", "sample_rate": 250000,
    "centre_hz": 98000000, "vfo_hz": 98000000,
    "fft_span_hz": 8000000, "fft_bins": 2048 }
  ```

  `fft_span_hz` is the total width the bins span, **centred on `centre_hz`**; `fft_bins` is the bin count.
  Omit both (or send `0`) and Bridge keeps the waterfall hidden — the "graceful degrade" path (`rtl_tcp` does
  exactly this, since it announces no FFT). Note the FFT span is **independent of `sample_rate`** and is
  normally much wider: decimate the IQ to an RDS-appropriate rate for decoding while still offering a wideband
  view. Bridge treats them as two rates by design — the waterfall spans `fft_span_hz`, the decoder works within
  `sample_rate`, and a waterfall click outside the decoded span becomes a `tune` (§7).
- Then send `0x0003` frames (spec **§5.3**): from byte 2 onward, one **UInt8 per bin**, ordered low → high
  across `fft_span_hz`, bin count matching `fft_bins`. `0` is the bottom of your dB window and `255` the top;
  you choose that window and Bridge applies its own floor/ceil/lift on top, so a full-range mapping is the
  useful one. These are display bins, not spectrum data — cheap (a few kB/s); ~10–25 frames/s is comfortable.

> If you implement this, the normative reference is **§5.3** of `PROTOCOL-generic-iq.md`, and the working
> reference is the helper's `spyserver.go` (SpyServer relays a display FFT; `rtl_tcp` announces none and Bridge
> degrades gracefully).

---

## 5. Control — Bridge driving your tuner (opt-in)

By default Bridge is a pure **observer** and sends you nothing. If — and only if — you set `controllable: true`
in your `hello`, Bridge may send:

```json
{ "kind": "control", "action": "tune",     "vfo_hz": 98500000 }
{ "kind": "control", "action": "recentre", "centre_hz": 98500000, "vfo_hz": 98500000 }
```

- `tune` — move the tuned station to `vfo_hz`.
- `recentre` — move the *capture centre* onto the station (centre and VFO together) so it sits mid-span, clear
  of band-edge roll-off.

**Two rules you must honour if you opt in:**

1. **Refuse cleanly if you can't act.** If control arrives while you're effectively not controllable, reply
   `{ "kind": "error", "code": "not-controllable" }` and ignore it. Then it's good practice to snap Bridge's
   readout back to your real centre with a `{ "kind": "meta", "vfo_hz": <real centre> }` frame — otherwise the
   dial shows a tune that never happened.
2. **Re-announce after a successful tune.** Do not assume Bridge will figure out your new centre on its own —
   **send a fresh `stream` (or `tune`) frame carrying the new `centre_hz`.** This bit the reference helper
   hard: SpyServer sends no confirmation to a frequency set and `rtl_tcp` confirms nothing at all, so Bridge
   sat on the *pre-tune* centre — the waterfall didn't follow and the decode offset was silently wrong. Push
   the new state yourself the instant the tune succeeds.

If you set `controllable: false` (the recommended default), Bridge greys out its tuning controls for your
session and never emits a `control` frame. Control is a privilege you grant, not one Bridge assumes.

---

## 6. Versioning & negotiation (§8)

- `protocol: "rds-bridge-iq/<major>"`. You and Bridge interoperate **iff you share the major**. On an unknown
  major Bridge logs the mismatch and refuses to stream — no partial/garbage decode.
- New optional JSON fields are additive within a major; unknown fields are ignored by both sides. New `mode` or
  `frame_type` values are additive and must never repurpose existing ones.
- **Match versions if you also relay Bridge's own binary protocol** (the helper does): a mismatched pair
  produces corrupt audio and junk decode, not a clean error. Keep your source and the Bridge build you target
  in step.

---

## 7. Security (§9) — read this, it's short

- **There is no authentication on this socket.** Neither rigctld nor CAT authenticate either; this protocol
  matches that reality rather than pretending otherwise.
- **Keep the server on localhost or a trusted LAN. Do not expose it to the internet.**
- `ws://` is the expected transport for local/LAN use. `wss://` is permitted where you terminate TLS; Bridge
  treats the URL opaquely. Browser secure-context rules still apply to Bridge itself.

---

## 8. Minimal `iq16` source (Python)

A complete, spec-conformant skeleton. It stands up a server, does the handshake, streams IQ, and handles a
tune uplink. Swap `read_iq_block()` for your real SDR. (Uses the `websockets` library: `pip install websockets`.)

```python
import asyncio, json, struct, websockets

CENTRE_HZ   = 98_000_000
SAMPLE_RATE = 250_000          # >= ~120 kHz or the 57 kHz subcarrier isn't there
IQ16        = 0x0002

def tagged(frame_type: int, payload: bytes) -> bytes:
    return struct.pack("<H", frame_type) + payload      # 2-byte LE tag + payload

def iq_to_bytes(interleaved_int16) -> bytes:
    # interleaved [I, Q, I, Q, ...] as Python ints in [-32768, 32767]
    return struct.pack("<%dh" % len(interleaved_int16), *interleaved_int16)

async def read_iq_block():
    # --- replace with your SDR: return a list of interleaved int16 I,Q,I,Q,... ---
    # Bridge only decodes RDS from real >=120 kHz-wide FM broadcast IQ.
    await asyncio.sleep(0.02)
    return [0] * 10_000

async def handle(ws):
    # 1) hello
    await ws.send(json.dumps({
        "kind": "hello", "protocol": "rds-bridge-iq/1",
        "source": "example-python-source 1.0",
        "live": True, "controllable": True,
    }))
    # 2) stream announce
    await ws.send(json.dumps({
        "kind": "stream", "mode": "iq16",
        "sample_rate": SAMPLE_RATE,
        "centre_hz": CENTRE_HZ, "vfo_hz": CENTRE_HZ,
    }))

    # handle Bridge's control uplink concurrently with streaming
    async def rx():
        async for msg in ws:
            if isinstance(msg, (bytes, bytearray)):
                continue                      # Bridge never sends us samples
            m = json.loads(msg)
            if m.get("kind") == "control" and m.get("action") == "tune":
                new_centre = int(m["vfo_hz"])
                # ... retune your hardware to new_centre ...
                # then RE-ANNOUNCE — Bridge won't infer the new centre itself:
                await ws.send(json.dumps({
                    "kind": "stream", "mode": "iq16",
                    "sample_rate": SAMPLE_RATE,
                    "centre_hz": new_centre, "vfo_hz": new_centre,
                }))

    rx_task = asyncio.create_task(rx())
    try:
        # 3) stream IQ forever
        while True:
            block = await read_iq_block()
            await ws.send(tagged(IQ16, iq_to_bytes(block)))
    finally:
        rx_task.cancel()

async def main():
    async with websockets.serve(handle, "127.0.0.1", 8765):
        print("Point RDS Bridge at ws://127.0.0.1:8765/")
        await asyncio.Future()

asyncio.run(main())
```

The `meta`-mode version is smaller still: send `hello` + a `stream` with `mode:"meta"` and just `vfo_hz`, then
emit `{"kind":"meta","vfo_hz":...}` whenever your tuner moves. No binary frames at all.

---

## 9. Checklist before you call it done

- [ ] Your app is a **WebSocket server**; Bridge connects to it.
- [ ] First text frame is a `hello` with `protocol: "rds-bridge-iq/1"`.
- [ ] `stream` is sent **before** any binary frame, with `sample_rate ≥ ~120 kHz`.
- [ ] Binary `iq16` frames start with tag bytes **`02 00`**, then Int16 LE interleaved I/Q.
- [ ] You send a `tune`/`stream` frame whenever *your* tuning changes.
- [ ] If `controllable: true`: you **re-announce the new centre** after every honoured tune, and reply
      `error`/`not-controllable` when you can't tune.
- [ ] Server is on localhost / trusted LAN only.
- [ ] Endianness verified little-endian on your target platforms.

---

## 10. Where to look next

- **Normative wire contract:** [`PROTOCOL-generic-iq.md`](./PROTOCOL-generic-iq.md).
- **Reference implementation:** [`helper/iqlane.go`](./helper/iqlane.go) (framing, control, re-announce),
  [`helper/ws.go`](./helper/ws.go) (stdlib WebSocket server), [`helper/spyserver.go`](./helper/spyserver.go)
  and [`helper/rtltcp.go`](./helper/rtltcp.go) (two real sources).
- **Wire-byte conformance test:** [`helper/protocol_test.go`](./helper/protocol_test.go).
- **Questions / first-integrator coordination:** `info@rdsbridge.com`, or the Discord in the project README.

RDS Bridge also speaks SDRplay's **SDRconnect WebSocket API** directly (port 5454) as a *separate* upstream —
but that's SDRplay's protocol for their app, not the surface for third-party sources. If you're integrating your
own app, the generic IQ protocol above is the one you want.
