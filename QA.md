# ✅ Timbrel — QA checklist

Manual verification of **every live, user-reachable feature** as of now. Work
top-to-bottom; each box is one observable behaviour (steps → **Expect**).

## Prerequisites

- App running: `cd apps/desktop && npm run dev`.
- **2–3 audio files** on disk (mp3/wav/flac/m4a…) and **≥1 already-separated song** in the library
  (separate one as part of §3 if needed).
- **Internet** (YouTube search + LRCLIB lyrics).
- For §13 (routing): **2+ output devices** connected — ideally **1 wired + 1 Bluetooth** so you can
  also feel the drift behaviour.

> **Not in scope** (parked / not reachable — confirm they are simply *absent*, not testable):
> **Spotify import** (component exists but unmounted), **first-run sidecar downloader** (no UI), a
> **settings screen**, global keyboard shortcuts, drag-and-drop, song rename/delete.

Routing legend: **Default target** = where un-overridden channels go · **Override** = a channel
pulled out to its own device(s) · **Tag** = a named group of devices.

---

## 1. Navigation & shell

- [ ] **Library is home** — app opens on the **Library** screen.
- [ ] **Search open/close** — **🔍 Search & download** → Search screen; **← Library** → back.
- [ ] **Open a song** — click a separated song → **Studio**; **← Library** → back.
- [ ] **Output button everywhere** — the **🔊 Output** button (bottom-right) is visible on Library,
      Search **and** Studio.
- [ ] **No global hotkeys** — spacebar does **not** play/pause (no transport shortcuts exist).

## 2. Library

- [ ] **Header actions** — **🔍 Search & download** and **+ Add track** present; while an upload
      starts, Add track disables and reads **"Working…"**.
- [ ] **Empty state** — no songs and no jobs → **"No tracks yet"** + the split-into-stems hint.
- [ ] **Row content** — a separated row shows title, `artist · N BPM · key`, and duration `m:ss`
      (or **"Ready"** if duration unknown).
- [ ] **Unseparated not clickable** — a processing song shows **"Processing…"**, is dimmed and
      **cannot be opened**.
- [ ] **Job card** — while a separation runs, a card shows the stage label + a progress bar; an error
      shows in red instead.

## 3. Import — local upload

- [ ] **File filter** — **+ Add track** opens a native dialog offering only audio types
      (mp3/m4a/wav/flac/ogg/oga/aac/aiff/aif).
- [ ] **Separate a file** — pick a new file → job runs **Queued → Loading model → Separating stems →
      Encoding FLAC → Detecting tempo & key** → the song becomes separated & clickable.
- [ ] **Dedup** — re-add the **same** file → it **opens the existing song directly** (no re-process).
- [ ] **Cancel** — cancel the file dialog → nothing happens, no job.
- [ ] **Start failure** — (if triggerable) a bad start shows a native **"Could not start
      separation: …"** alert.

## 4. Import — YouTube search & download

- [ ] **Search** — box is autofocused; type a song + **Enter** (or **Search**) → **"Searching
      YouTube…"** then result rows (thumbnail, title, `channel · duration`).
- [ ] **Empty query** — Search button disabled when the box is empty.
- [ ] **No results** — a nonsense query → **"No results — try different words."**
- [ ] **Download → separate** — a result's **Download** → progress (**Downloading → Loading model →
      Separating stems → Encoding FLAC → Detecting tempo & key**) → button becomes **"Open in
      studio ↗"**.
- [ ] **Open in studio** — that button opens the Studio for the new song.
- [ ] **Dedup** — download a video that's already separated → opens directly.
- [ ] **Error + retry** — a failed import shows a red dismissible banner and the row offers
      **Retry**.

## 5. Studio — transport

- [ ] **Play / pause** — **▶** starts, **❚❚** pauses; audio follows.
- [ ] **Scrubber seek** — drag the transport slider → playhead jumps; current-time + duration read
      as `m:ss`.
- [ ] **Seek from lane** — click anywhere on a waveform lane → playback seeks there.
- [ ] **Grid nudge** (only if beats detected) — **−** / **+** shift the grid in **±10 ms** steps; the
      `±N ms` readout updates and the beat lines move.

## 6. Studio — tempo & key

- [ ] **Tempo** — slider spans **50%–150%**; readout shows effective **BPM** + `(±N%)`; audio
      speeds/slows with **pitch preserved**.
- [ ] **Tempo reset** — **↺** returns to 100% (disabled when already 100%).
- [ ] **Key** — **−** / **+** shift by **1 semitone**, clamped **−12…+12**; **pitch shifts, tempo
      preserved**; readout shows `±N st` (+ transposed key if known).
- [ ] **Key reset** — **↺** returns to 0 (disabled when already 0).

## 7. Studio — loop

- [ ] **Create** — drag across the **Loop** ruler → a region appears; play → it **loops** within.
- [ ] **Resize** — drag a region **edge** → range changes.
- [ ] **Move** — drag the region **body** → it shifts.
- [ ] **Toggle** — the **Loop** button enables/disables wrapping (region stays; wrapping only when
      enabled).
- [ ] **Clear** — **×** (or a plain click on the ruler) removes the loop.

## 8. Studio — metronome & count-in

- [ ] **Metronome** — toggle on → a click sounds **on every beat** during playback (accented
      downbeats).
- [ ] **Count-in** — toggle on → pressing play plays **one bar of clicks** (shows **…**), then the
      transport rolls; pressing again mid-count cancels.
- [ ] **Ephemeral** — both reset to **OFF** after reloading the song (by design).

## 9. Studio — mixer & lanes

- [ ] **Stem order** — rows are **Vocals, Drums, Bass, Guitar, Piano, Other** (only detected stems).
- [ ] **Mute (M)** — mutes that stem; button turns red.
- [ ] **Solo (S)** — only soloed stems are audible; the rest **dim to 50%**.
- [ ] **Volume** — the per-stem slider (0–1) changes only that stem's level.
- [ ] **Beat grid** — faint lines per beat (brighter on downbeats) overlay the lanes; the **playhead**
      line tracks playback.
- [ ] **Inline routing dropdown** — each stem has an output picker under its fader (tested in §13).

## 10. Studio — lyrics

- [ ] **Open** — **Lyrics** button opens the right-side panel (badge shows `synced|plain · source`).
- [ ] **Synced highlight** — the current line **bolds and auto-scrolls to center** as playback moves.
- [ ] **Click to seek** — clicking a synced line **seeks** to that lyric's time.
- [ ] **Plain fallback** — a plain-lyrics track shows static text (no highlight, no seek).
- [ ] **None** — a track with no match shows **"No lyrics found for this track…"**.

## 11. Export

- [ ] **Open** — **Export** opens the modal.
- [ ] **Modes** — all four present: **Separate stems**, **Custom mixdown**, **Minus one**, **Click
      track**.
- [ ] **Stem picker** (stems/mixdown) — checkbox grid with **All / None**; defaults to the
      **currently-audible** stems (respects mute/solo).
- [ ] **Minus one** — a `<select>` chooses which stem to remove.
- [ ] **Format & quality** — **WAV / FLAC / MP3**; lossless → **16/24-bit** select; MP3 →
      **320/256/192/128 kbps** select.
- [ ] **Bake tempo/key** — checkbox **on by default**, **greyed out when tempo & key are neutral**
      ("nothing to bake").
- [ ] **Validation** — click-track with no beats, 0 stems selected, or <2 stems for minus-one each
      **block Export** with the matching message.
- [ ] **Single-file export** — a one-file config opens a **Save dialog** (suggested `Title -
      suffix.ext`); file is written and plays back correctly.
- [ ] **Multi-file export** — separate-stems with >1 stem opens a **folder picker**; N files written,
      one per stem.
- [ ] **WYSIWYG** — with tempo/key changed + bake on, the exported audio matches what you heard.
- [ ] **Status + close** — status streams **Rendering… → Encoding… → Exported N file(s)**; Close (or
      the scrim, when idle) dismisses.

## 12. Persistence

- [ ] **Studio state survives reload** — change mixer (gain/mute/solo), tempo, key, loop and grid
      nudge → leave & reopen the song → **all restored**.
- [ ] **Ephemeral resets** — metronome and count-in are **OFF** after reopening.
- [ ] **Instant waveforms** — reopening a song renders waveforms immediately (cached peaks).
- [ ] **Lyrics cached** — a previously-fetched song shows lyrics without re-fetching.

## 13. Multi-device output routing

Open the panel via **🔊 Output** (works even with no song loaded). Routing is a **global "live
rig"** applied to whatever song is open.

### 13.1 Detection & baseline
- [ ] **Devices detected** — panel lists every connected output by its **real name** (not a blank id).
- [ ] **No-op default** — fresh (nothing routed): audio comes out the **system default** output,
      exactly as before the feature existed.
- [ ] **Hot-plug appears** — with the panel open, plug in an output → it **appears within ~1 s**.
- [ ] **Hot-unplug disappears** — unplug it → it **drops off** the list.

### 13.2 Tags (one tag per device)
- [ ] **Create a tag** — on a device row pick **"New tag…"** → inline field → type + **Enter** →
      device shows that tag.
- [ ] **Cancel entry** — pick "New tag…", press **Escape** / click away → no tag created.
- [ ] **Tag propagates** — the new tag appears as an option in the **Default output** picker and
      **every per-channel** picker.
- [ ] **Group two devices** — assign the **same** tag to a second device → both are in that tag.
- [ ] **One tag per device** — assign a **different** tag to a device that already had one → the old
      tag is **replaced**, not added.
- [ ] **Untag** — set a device to **"No tag"** → it leaves the group.
- [ ] **Tags persist** — quit & reopen → tag assignments are still there.

### 13.3 Default target (inheritance)
- [ ] **Starts as System** — Default output reads **"System Default"** on a fresh rig.
- [ ] **→ a device** — set default to one device → the **whole mix** plays there.
- [ ] **→ a tag (play on all)** — set default to a tag of 2 devices → the mix plays on **both at
      once**.
- [ ] **→ multiple** — tick several devices/tags → mix plays on **all of them simultaneously**.
- [ ] **Stems inherit** — un-overridden stems all follow the default.

### 13.4 Per-stem override (exclusive pull-out)
- [ ] **Override to a device** — vocals → headphones (panel row **or** the picker under the fader) →
      vocals play **only** on the headphones.
- [ ] **Pull-out is exclusive** — simultaneously the **speakers play everything EXCEPT vocals** (the
      overridden stem leaves the default path, never doubled).
- [ ] **Override to a tag** — a stem → a tag → plays on **all devices in that tag**.
- [ ] **Different stems, different devices** — vocals → headphones **and** drums → speaker at once
      (the DJ/monitor case) → both route correctly.
- [ ] **Panel ↔ inline in sync** — change a stem in the panel → the fader picker reflects it, and
      vice-versa (same underlying rig).
- [ ] **Back to default** — set an overridden stem to **"Follow default"** → it rejoins the default.

### 13.5 Metronome / click (the 7th channel)
- [ ] **Click in headphones only** — route **click → headphones**, rest on the speakers → enable the
      metronome → **clicks only in headphones**, music only on speakers. ⭐
- [ ] **Click follows default** — with no click override, the metronome plays on the default target.

### 13.6 Drift warning
- [ ] **Warning on split** — route stems across **>1 physical device** → the ⚠ drift note appears.
- [ ] **Warning clears** — route everything back to one device → the warning **disappears**.
- [ ] **Drift is real (BT case)** — a stem on Bluetooth vs siblings on a wired device → you can
      **hear them drift** (expected — this is what the warning is about).

### 13.7 Disconnection (split by layer)
- [ ] **Override device dies → silent** — vocals overridden to headphones, disconnect them → vocals
      **go silent** + a **"MUTED — device gone"** indicator (they do **not** blast the speakers).
- [ ] **Default device dies → system fallback** — set default to a device, disconnect it → audio
      **falls back to the system output** (not fully silent).
- [ ] **Reconnect auto-reattaches** — plug the device back in → routing **resumes automatically**.

### 13.8 Reset
- [ ] **Reset routing** — **Reset** returns default + every override to **System Default**, but
      **tags/devices stay assigned** (only routing is cleared).

### 13.9 Global scope & persistence
- [ ] **Survives restart** — set routing, quit & reopen → routing restored.
- [ ] **Global, not per-song** — set routing on song A, open song B → the **same routing applies**.
- [ ] **Works with no song** — open the panel from the Library (no song) → you can tag devices, set
      the default, and edit the matrix.

### 13.10 Interaction with tempo/key
- [ ] **Tempo/key + routing** — change tempo and key while stems are routed to different devices →
      pitch/tempo are **correct on every device**.
- [ ] **Neutral = no regression** — normal playback on the default rig sounds **identical to before**.

## 14. Error surfaces (confirm they appear, worded clearly)

- [ ] Upload start fail → native alert.
- [ ] Separation job error → red text in the Library job card.
- [ ] Search/download error → red banner + per-row **Retry**.
- [ ] Studio load error → red inline message.
- [ ] Export failure → red **"Export failed: …"** in the modal.

---

### Notes / found issues

<!-- log failures: section #, what you saw vs expected, device/song/OS -->
