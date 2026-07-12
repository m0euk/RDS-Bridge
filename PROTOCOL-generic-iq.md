# RDS Bridge — generic IQ WebSocket protocol

**Status:** `rds-bridge-iq/1` · **meta mode shipped in 0.8.0** · `iq16`/`composite` reserved (0.8.2+).
Clean-room, purpose-built (not SDRConnect emulation).
**Integration cost in Bridge:** shell-only. Both DSP workers stay byte-identical (`WORKER_SRC b8e3ecb3…`,
`DCWORKER_SRC 19785acb…`) — every frame maps onto worker messages Bridge already sends (`rate`/`offset`/
`reset`/`iq`). The 0.8.0 meta client implements the metadata channel (§4); the sample channel (§5) lands
with the `iq16` branch in 0.8.2.

This document is the contract between **RDS Bridge** (the WebSocket *client*) and any **source** that wants
to feed it — the first being an external IQ application that hosts the server. It is an open invitation: any SDR app or
helper that speaks these frames can drive Bridge, on any platform.

---

## 1. Design goals

- **One socket, self-describing.** A source announces what it is sending; Bridge adapts. No out-of-band config.
- **Reuse the frozen decode path.** IQ arrives in the exact shape `feedIQ` already consumes, so the sacred
  workers are untouched. The protocol is a wire format around an existing internal contract, nothing more.
- **Observer by default.** Bridge decodes; it does not control the source unless the source explicitly opts in.
- **Cross-platform and small.** A source needs a WebSocket server and the ability to emit Int16 IQ — nothing else.

### Non-goals

- Not a rig-control protocol. Tuning *can* flow Bridge→source, but only when the source permits it (§7); the
  default and the common case is one-way, source→Bridge.
- Not a general SDR streaming standard. It carries exactly what RDS decoding needs: a channel wide enough to
  hold the 57 kHz subcarrier, plus the frequency metadata to label and log the catch.
- Not SDRConnect's `{event_type, property, value}` property bag. That path stays as-is for SDRConnect; this is
  a cleaner, minimal framing for third parties.

---

## 2. Roles and transport

- **Bridge is the WebSocket client.** It opens `ws://host:port/…` (or `wss://` — §9). The **source is the server.**
- `binaryType` is `arraybuffer`.
- Two frame kinds share the one socket, distinguished by WebSocket opcode:
  - **Text frames** carry **JSON** — the control / metadata channel (§4).
  - **Binary frames** carry **samples** — IQ (and, reserved, composite) (§5). First 2 bytes are a little-endian
    type tag, mirroring how Bridge already demultiplexes binary frames today.

The source connects, sends a `hello`, then a `stream` descriptor, then begins emitting sample frames and
metadata updates. Bridge never sends samples; it sends only an optional `hello` ack and, if permitted, control.

---

## 3. Payload modes

The `stream` descriptor (§4.2) carries a `mode`. Three are defined; **0.8.0 implements the first two.**

| `mode`      | Direction of samples | Binary payload            | 0.8.0 | Notes |
|-------------|----------------------|---------------------------|-------|-------|
| `meta`      | none (metadata only) | —                         | ✅    | Frequency sidecar. Rides *alongside* another sample source (e.g. MPX audio via a virtual cable). Bridge takes only the frequency, to label/log the catch. |
| `iq16`      | source → Bridge      | Int16 interleaved I/Q     | ✅    | The direct-IQ case. Feeds the frozen `feedIQ` path. |
| `composite` | source → Bridge      | Float32 MPX composite     | reserved | MPX-over-socket. Not built in 0.8.0 — MPX already has its audio-cable path. Reserved so the frame need not change to add it later. |

`meta` mode is the shared foundation: **every** mode carries the metadata channel; `iq16` and `composite` add
a sample channel on top. A source that only knows the tuned frequency (a CAT/rigctld helper) sends `mode:"meta"`.

---

## 4. Control / metadata channel (JSON text frames)

All text frames are a single JSON object with a `kind` field.

### 4.1 `hello` (source → Bridge, first)

```json
{
  "kind": "hello",
  "protocol": "rds-bridge-iq/1",
  "source": "example-iq-source 1.0",
  "live": true,
  "controllable": false
}
```

- `protocol` — `rds-bridge-iq/<major>`. Bridge refuses a major it doesn't implement (§8).
- `live` — `true` for a real-time stream; `false` for finite/seekable playback. Governs retune/logging behaviour
  (a `live` source's frequency changes are station changes to be logged; a file's are seeks).
- `controllable` — whether the source will accept control frames (§7). If absent, assume `false`.

Bridge may reply `{"kind":"hello","protocol":"rds-bridge-iq/1","role":"bridge"}`. Sources must not require it.

### 4.2 `stream` (source → Bridge, before samples)

```json
{
  "kind": "stream",
  "mode": "iq16",
  "sample_rate": 240000,
  "centre_hz": 98000000,
  "vfo_hz": 98200000,
  "format": { "sample": "int16", "layout": "interleaved-iq", "endian": "little", "header_bytes": 2 }
}
```

- `mode` — §3.
- `sample_rate` — samples/s of the IQ stream. **Must be ≥ ~120 kHz** or the 57 kHz RDS subcarrier is not in the
  stream and Bridge will warn and decode nothing. High rates are fine: Bridge engages its downconvert worker for
  wideband input exactly as the file path does — the source need not decimate.
- `centre_hz` — the capture centre (LO). The IQ is centred here.
- `vfo_hz` — the tuned station within the capture. Bridge decodes the channel at offset `vfo_hz − centre_hz`.
  (This **centre/VFO split** is what lets a source stream a wide capture while Bridge decodes one station inside it,
  and what makes "recentre" meaningful — see §7.)
- `format` — present for sample modes; omit for `meta`. For `iq16` it is fixed as shown: signed 16-bit, interleaved
  I then Q, little-endian, with a 2-byte type header ahead of the samples (§5). `header_bytes` lets the layout be
  stated explicitly rather than assumed.

For `mode:"meta"`, omit `sample_rate` and `format`; send only `centre_hz`/`vfo_hz` (usually just `vfo_hz`).

### 4.3 `tune` (source → Bridge, on any change)

Sent whenever the source's tuning moves — the source pushing its state to Bridge (**VFO-follow**).

```json
{ "kind": "tune", "centre_hz": 98000000, "vfo_hz": 98500000 }
```

Bridge's response mirrors its existing live logic:

- It recomputes the offset `vfo_hz − centre_hz` and **nudges the decode mixer** — no decode reset — for small moves.
- A move greater than ~50 kHz is treated as a **genuine station change**: Bridge resets the decode accumulators and
  clears the RDS display, then re-acquires. This is the same threshold and behaviour as the SDRConnect path.
- If only `centre_hz` moves while `vfo_hz` is unchanged (a **recentre** — the capture re-framed around the same
  station), Bridge holds the RDS lock: the tuned frequency didn't change, so it is not a station change.

### 4.4 `meta` (source → Bridge, metadata-only updates)

For `mode:"meta"` sources, the frequency sidecar update:

```json
{ "kind": "meta", "vfo_hz": 98500000 }
```

Bridge uses this only to label and log the catch (the DX log keys on frequency; MPX otherwise logs by PI). It does
not drive the decoder, because in `meta` mode the samples are arriving by another route.

### 4.5 `bye` (either direction, optional)

```json
{ "kind": "bye" }
```

A clean shutdown hint. Bridge also handles a bare socket close; sources should tolerate one too. (Async close
ordering is a known hazard in Bridge — see the handover's frozen-waterfall note — so teardown must not assume a
`bye` arrives before `onclose`.)

---

## 5. Sample channel (binary frames)

Binary frame layout, little-endian throughout:

```
byte 0..1   uint16   frame_type      (0x0002 = iq16 samples;  0x0006 = composite, reserved)
byte 2..N            payload
```

### 5.1 `iq16` payload

From byte 2 onward: signed 16-bit integers, **interleaved I, Q, I, Q, …**. The number of complex samples is
`(byteLength − 2) / 4`. This is byte-for-byte what Bridge's decode worker already reads (`Int16Array(buf, 2)`),
which is why no worker change is needed. Frame size is the source's choice; a few ms of samples per frame keeps
latency low without excessive framing overhead.

Full-scale is ±32767. If a source's native samples are Float32, it should scale to Int16 before sending (or use a
future `iqf32` variant, at which point Bridge scales in the shell — never assuming ±1 normalisation, always
measuring, per the file-path lesson). 0.8.0 defines `iq16` only.

### 5.2 `composite` payload (reserved)

`frame_type 0x0006`, Float32 mono MPX composite from byte 2. Reserved, not implemented in 0.8.0. Documented so the
type space is stable.

---

## 6. Sequence of a session

**Direct-IQ source (`iq16`) —**
1. Bridge connects; sends optional `hello`.
2. Source → `hello` (`live:true`, `controllable:` per app).
3. Source → `stream` (`mode:"iq16"`, `sample_rate`, `centre_hz`, `vfo_hz`, `format`).
4. Source → binary `iq16` frames continuously; `tune` frames whenever the user retunes in the source app.
5. Bridge decodes, follows tuning per §4.3, logs catches by frequency.

**CAT/rigctld helper (`meta`) —**
1. Bridge connects.
2. Helper → `hello` (`live:true`, `controllable:false`).
3. Helper → `stream` (`mode:"meta"`, `vfo_hz`).
4. Helper → `meta` frames as the SDR app's frequency changes (helper polling rigctld/CAT underneath).
5. Bridge decodes MPX from the audio cable as today, but now labels/logs each catch with the real frequency.

---

## 7. Control (Bridge → source), and refusal

By default Bridge is an **observer** and sends no control. A source that sets `controllable:true` in `hello` may
accept:

```json
{ "kind": "control", "action": "tune",     "vfo_hz": 98500000 }
{ "kind": "control", "action": "recentre", "centre_hz": 98500000, "vfo_hz": 98500000 }
```

- `tune` asks the source to move the tuned station. `recentre` asks it to move the capture centre onto the station
  (centre and VFO together) so the station sits mid-span, clear of band-edge roll-off — the same operation as
  Bridge's existing "centre ⌖" on the SDRConnect path.
- A source that receives control while `controllable:false` should reply `{"kind":"error","code":"not-controllable"}`
  and ignore it.
- **Bridge-side refusal is the default.** When a source declares `controllable:false` (or omits it), Bridge greys out
  its tuning controls for that session and never emits a `control` frame. This mirrors the `can_control` gate on the
  live path: no tuning UI acts on a source that hasn't opted in. Control is a privilege the source grants, not one
  Bridge assumes.

Keeping a source **one-way** (`controllable:false`) is the expected, recommended default. Two-way is opt-in for
sources that genuinely want Bridge to drive them.

---

## 8. Versioning and negotiation

- `protocol: "rds-bridge-iq/<major>"`. A source and Bridge interoperate iff they share `<major>`. Bridge, on an
  unknown major, logs the mismatch and does not stream.
- New optional JSON fields may be added within a major; unknown fields are ignored by both sides. New `mode` or
  `frame_type` values are additive and must not repurpose existing ones.

---

## 9. Security

- rigctld and CAT have **no authentication**, and neither does this socket. Keep the source and Bridge on
  **localhost or a trusted LAN**; do not expose the server to the internet.
- `ws://` is expected for localhost/LAN. `wss://` is permitted where a source terminates TLS; Bridge treats the URL
  opaquely. Browser secure-context rules still apply to Bridge itself (the localhost-launcher requirement is
  unchanged by this protocol).

---

## 10. Mapping to Bridge internals (informative)

Proof that integration is shell-only. Each protocol element resolves to something Bridge already does:

| Protocol element                    | Bridge internal (unchanged)                                             |
|-------------------------------------|-------------------------------------------------------------------------|
| `stream.sample_rate`                | `worker.postMessage({type:"rate", rate})`; engages downconvert worker if wideband, exactly as the file path decides via `dcEngaged`. |
| `stream.centre_hz` / `tune`         | `curCenter`; offset recompute in `maybeRetune`.                          |
| `stream.vfo_hz` / `tune`            | `curVfo`; `worker.postMessage({type:"offset", hz: vfo − centre})`.       |
| station change (>50 kHz)            | `worker.postMessage({type:"reset"})` + `clearRdsUI()`.                   |
| recentre (centre moves, vfo same)   | lock held; not a station change (the `recentring` guard).                |
| binary `iq16` frame                 | `worker.postMessage({type:"iq", buf})` → `demod(Int16Array(buf,2))`, via `feedIQ`. |
| `meta.vfo_hz`                       | frequency used by `logCatch` / summary only; decoder untouched.          |
| `controllable:false`                | the `canControl` gate — tuning UI inert, no control emitted.             |
| `sourceMode`                        | the reserved `"wsiq"` enum value; `feedIQ` fork reused.                  |

The only new shell code is: a `wsiq` branch that parses these frames and drives the calls in the right column. The
workers, and the SHAs, do not move.

---

## 11. Open questions to resolve with the first IQ-source integrator (before locking 1.0)

1. **Frame cadence / size** for `iq16` — target ms-per-frame, and whether a sequence counter is wanted for
   drop detection (Bridge currently infers rate from sample count per second).
2. **Rate ceiling** the source will emit — confirms whether Bridge should always route wideband through the
   downconvert worker or can take some rates directly.
3. **`controllable`** — will the source accept `tune`/`recentre`, or ship one-way for 0.8.0?
4. **Startup ordering** — is `stream` guaranteed before the first binary frame, and is a re-`stream` sent on a
   mode/rate change mid-session?
5. **Endianness** confirmation on the target platforms (spec says little-endian; worth an explicit check).
