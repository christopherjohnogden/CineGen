# Upcoming Release — Feature Changelog

> **Status:** Draft — update this file as work continues, then copy into a GitHub Release when you ship.  
> **Last updated:** May 28, 2026

Use this document to announce what’s new in the next CineGen update. Items marked **(committed)** are already on `main`; items marked **(in progress)** include local/uncommitted work from the current session.

---

## Highlights

- **New fal.ai video models:** Seedance 2.0 (text/image + reference-to-video)
- **Multi-shot workflows:** “Shot Prompt” renamed to **Multi Prompt** (matches Kling 3 API)
- **fal.ai model audit:** 39 cloud models reviewed; inputs, outputs, and routing aligned with official API schemas
- **Video quality controls:** Resolution / quality selectors on every video node that supports them
- **Smarter routing:** Endpoint-based quality tiers (Kling 3, Sora 2, LTX 2.3 Pro/Fast) handled automatically

---

## New Features

### Seedance 2.0 (fal.ai) **(committed)**

Two new Spaces video nodes:

| Node | Endpoint | Description |
|------|----------|-------------|
| **Seedance 2.0** | `text-to-video` / `image-to-video` | Auto-routes when a first frame is connected |
| **Seedance 2.0 Reference** | `reference-to-video` | Multi-modal references (images, video, audio) |

**Controls:** prompt, first/last frame, duration (auto + 4–15s), resolution (480p/720p/1080p), aspect ratio, generate audio, seed.

---

### Multi Prompt utility node **(committed)**

- Renamed **Shot Prompt** → **Multi Prompt** to match the `multi_prompt` port on Kling 3 and similar models
- Node type is now `multiPrompt` (was `shotPrompt`)
- **Backward compatible:** old workflows with `shotPrompt` nodes migrate automatically on load

Use Multi Prompt to define multiple shots (prompt + duration each) and connect to Kling 3 for multi-shot video generation.

---

### Video quality & resolution selectors **(in progress)**

Every video model that supports quality or resolution now exposes it in the node settings:

| Model / group | Control | Options |
|---------------|---------|---------|
| **Kling 3** (fal) | Quality | Standard (720p) / Pro (1080p) / 4K |
| **Sora 2** (fal) | Quality + Resolution | Standard vs Pro tier; resolution auto-clamps on Standard |
| **LTX 2.3** / **LTX 2.3 Image to Video** | Quality + Resolution | Pro vs Fast endpoint; 1080p / 1440p / 4K |
| **KIE Kling 3.0** | Quality | Standard (720p) / Pro (1080p) / 4K |
| **KIE Veo 3.1** | Quality | Fast vs Quality |
| **Veo 3.1, Wan, Seedance, LTX, Sora, RunPod/Pod Wan, Local LTX** | Resolution | Per-model API options |
| **KIE Runway** | Quality | 720p / 1080p |

Models with **fixed output tiers** and no API control (Kling 2.5, MiniMax Video, LTX Audio/Extend/Retake, SAM 3 Track) are unchanged — no fake selectors added.

---

## Improvements

### fal.ai model registry audit **(committed + in progress)**

Full pass over **39 fal.ai nodes** in `MODEL_REGISTRY`. Goals: correct model IDs, parameter names, enum values, output paths, and alt-endpoint routing.

#### Video models

| Node | What changed |
|------|----------------|
| **Veo 3.1** | Removed invalid 1:1 aspect; added 4K, negative prompt, seed, auto-fix |
| **Kling 3** | Duration 3–15s; shot type; optional prompt when using Multi Prompt; quality tier routing |
| **Kling 2.5 Image** | Removed unsupported aspect ratio; added `tail_image_url` |
| **Kling First & Last** | Switched to v2.5 endpoint that supports `tail_image_url` |
| **MiniMax Video** | Added prompt optimizer |
| **Wan 2.2** | Added 580p, aspect ratio, negative prompt, last frame, FPS, guidance, seed |
| **LTX 2 Video** | altId for image-to-video; fps, audio, 4K resolution |
| **LTX 2.3 Fast** | Full duration range (6–20s) |
| **Sora 2** | Duration 4–20s; resolution options; IP blocking toggle; quality tier routing |
| **SAM 3 Track** | Fixed output path (`video.url`); added prompt, apply mask, detection threshold |

#### Image models

| Node | What changed |
|------|----------------|
| **FLUX 2 Max** | Fixed model ID (`fal-ai/flux-2-max`); safety tolerance, output format |
| **FLUX Dev / Fast SDXL / SD3** | Safety checker, formats, negative prompts, num images where supported |
| **Flux Kontext** | Correct image-to-image altId; strength param for edits |
| **Nano Banana Pro / 2** | Expanded aspect ratios; output format; safety/web search options; removed invalid seed (NB2) |

#### Audio & edit models

| Node | What changed |
|------|----------------|
| **ElevenLabs** (music, TTS, voice changer, STT, dubbing, isolation) | Expanded formats, timestamps, language codes, dubbing options |
| **SAM 3 Segment / Layer Decompose** | Interactive segmentation params; SAM prompt routing for layer decompose |
| **Qwen Image Layered / Edit** | Negative prompt, output format, safety checker, image size |
| **Whisper / Wizper** | Version options, diarization params |

---

### Workflow execution **(committed + in progress)**

- **Endpoint routing:** Quality/tier choices map to the correct fal.ai URL (not sent as invalid API params)
- **Param sanitization:** Strip image params on text-only endpoints (Seedance, LTX 2); strip routing-only `quality` without breaking KIE Runway’s real `quality` field
- **Type coercion:** Duration/FPS/music length coerced to correct API types (string vs number)
- **Flux Kontext:** Strips incompatible params when using image edit endpoint
- **Layer Decompose (cloud):** SAM 3 calls pass `return_multiple_masks` and `max_masks`

New module: `src/lib/fal/video-model-routing.ts` — shared logic for execute path and Electron IPC.

---

## Bug Fixes

- **FLUX 2 Max:** Wrong endpoint slug (`flux-2/max` → `flux-2-max`)
- **Kling First & Last:** `tail_image_url` was sent to an endpoint that ignored it
- **SAM 3 Track:** Response mapping pointed at non-existent `segmented_video.url`
- **ElevenLabs STT:** `language` renamed to `language_code` to match API
- **Nano Banana 2:** Removed unsupported `seed` parameter
- **Layer Decompose:** `reconstruct_bg` kept as app-only (not sent to SAM 3 API)
- **KIE Runway:** Quality param no longer stripped before API call **(in progress fix)**

---

## Migration & Compatibility

| Change | Action needed |
|--------|----------------|
| `shotPrompt` → `multiPrompt` | None — auto-migrated on workflow load |
| Kling 3 quality default | **Pro (1080p)** — same effective default as before |
| Sora 2 quality default | **Pro** — same endpoint as before |
| Existing workflows | Should run unchanged; new settings appear with defaults |

---

## Documentation

- README updated for Multi Prompt naming **(committed)**

---

## Suggested GitHub Release Title

**CineGen — Seedance 2.0, Multi Prompt, fal.ai model audit & video quality controls**

### Suggested release blurb (short)

```
### What's new
- Seedance 2.0 on fal.ai (text/image + reference-to-video)
- Multi Prompt node (renamed from Shot Prompt) for Kling 3 multi-shot video
- Quality/resolution selectors on all supported video models
- Full fal.ai model registry audit — fixes IDs, params, and API routing

### Fixes
- FLUX 2 Max, Kling First/Last, SAM 3 Track output mapping, and more

See UPCOMING_RELEASE.md for the full list.
```

---

## Checklist before shipping

- [ ] Commit remaining quality/routing changes (`video-model-routing.ts`, KIE labels, execute/IPC updates)
- [ ] Run `npm run build` and smoke-test Kling 3 / Sora 2 / LTX quality switching
- [ ] Copy relevant sections into GitHub Release notes
- [ ] Bump version in `package.json` if you version releases
- [ ] Archive or move shipped items from **Unreleased** to a dated section below

---

## Shipped history (move items here after release)

<!-- Example:
## v1.x.x — 2026-06-01
- ...
-->
