# Upcoming Release — Feature Changelog

> **Status:** Draft — update this file as work continues, then copy into a GitHub Release when you ship.  
> **Last updated:** August 20, 2026

Use this document to announce what’s new in the next CineGen update. Items marked **(committed)** are already on `main`; items marked **(in progress)** include local/uncommitted work from the current session.

---

## Highlights

- **Director tab:** script-to-Seedance 2.5 shotlist with takes and nested Edit media-pool folders
- **CINEDANCE / Oneiric clip prompts:** compiled bodies use the Higgsfield Oneiric block order (ACTIVE REFERENCES, FORMAT MODE, SEGMENT n, DIALOGUE, AUDIO, STYLE, POSITIVE LOCKS) instead of ELEMENTS / SHOT n
- **Oneiric Tig skills in-repo:** `skills/tig-acting-task` and `skills/tig-diagram` (blocking map) — scene direction compiles into `ACTING TASK`, staging stills attach last on Generate
- **Global Elements library:** characters, locations, props, and vehicles are shared across projects and organized in folders
- **New fal.ai video models:** Seedance 2.0 (text/image + reference-to-video)
- **Multi-shot workflows:** “Shot Prompt” renamed to **Multi Prompt** (matches Kling 3 API)
- **fal.ai model audit:** 39 cloud models reviewed; inputs, outputs, and routing aligned with official API schemas
- **Video quality controls:** Resolution / quality selectors on every video node that supports them
- **Smarter routing:** Endpoint-based quality tiers (Kling 3, Sora 2, LTX 2.3 Pro/Fast) handled automatically

---

## New Features

### Director tab **(in progress)**
- New workspace tab between **Spaces** and **Edit** that turns a script or idea into timed Seedance 2.5 clips
- Breakdown reviews characters/locations/props/vehicles and matches existing Elements by `@Tag` / name. Unmatched items stay as **suggestions** on the Breakdown rail (big ref image left, info right) — **Assign to existing** or **Create new element** (opens the New Element modal). Approving no longer auto-creates library entries, so you don't have to delete extras on the Elements page
- Shotlist compiler uses CINEDANCE / Oneiric prompt blocks (ACTIVE REFERENCES, FORMAT MODE, `SEGMENT n` with LENS / ACTION TASK, DIALOGUE, AUDIO, STYLE, POSITIVE LOCKS); isolate the selected beat as full multishot, held to clip length, or native length without creating a second clip **(in progress)**
- Generate queues takes per variant into `Director / Scene / Clip / Full|Shot N` media-pool folders (`1A · T01`, `1A · S3 · T01`)
- Look bible builder: upload a script, pick a Seedance genre, type film references, drop mood-board stills — **Look notes** live-updates from those refs and stays editable; **Rewrite with LLM** attaches up to 6 stills so the model can see them and write palette/lighting into the prefix that every clip prompt uses
- Breakdown / shotlist / look bible / rewrite run through a picked **Claude, Codex, or Gemini CLI** (same install detect as Copilot) — no fal key required
- Director CLI jobs use headless Claude `--permission-mode dontAsk`, show errors instead of spinning **Writing…**, and time out / cancel if the CLI hangs
- Look bible style prefix, director notes Keep/Discard rewrite, and a Seedance 2.5 video adapter (future model versions are extra adapters, not UI rewrites)

### Director tab: LLM script breakdown **(in progress)**

- Breakdown is **LLM-only**: the chosen Director LLM reads the script as a professional script supervisor / breakdown artist and returns the complete character, location, prop and vehicle list. The old instant lexicon extractor no longer auto-fills the rail while you type
- Accuracy pass: the script is sent with numbered **ACTION** lines; the model must quote evidence for each item using the script's own words (`jacket`, not "wardrobe"). A second supervisor audit then re-walks those lines for misses (ordinary clothes and furniture are the usual gaps) — still LLM judgment, not a noun list
- Rail cards are suggestions, not auto-created library Elements: big ref image on the left, name / `@tag` / INT-DAY pill on the right. Dismiss with ✕ (hides from this scene, or from every scene it appears in when **All scenes** is selected). Click a card to jump to its first highlight in the script — the mention lights up for a second so you can spot it. **Assign to existing** links a library element; **Create new element** opens the New Element modal
- Uploading a script starts the LLM breakdown immediately — no need to click **Run breakdown**. The button stays so you can re-run after you edit the script. Auto-sync will not fire a second pass for that same upload
- Scene nav has **All scenes** (default) so the right panel lists every unique element in the show at once; pick SC1 / SC2 / … to filter to that scene. The Approve button is gone — shotlisting no longer waits on it
- Full re-runs drop unassigned leftovers the model no longer listed; assigned Elements, scene headings, and enrichment (descriptions, profiles, voices) are kept. A scoped edit only adds/updates from the changed scenes
- Auto-sync waits for that LLM pass before shotlisting — a failed breakdown no longer continues into an empty bible

### Director tab: film-craft prompt system **(committed)**

- Breakdown, shotlist, look bible and rewrite jobs now run on a shared **craft doctrine** (`src/lib/director/craft/`) covering spatial blocking, lens optics, physics/lighting, character performance and palette discipline
- **Lens locks replace focal-length metadata:** clips carry a diagonal field of view (8° / 18° / 29° / 47° / 84° / 107°) that compiles into observable optical language plus the anti-drift lock for that lens — a stray value snaps to the nearest anchor
- **Blocking block** per clip: screen positions, body facing, gaze targets, depth and landmark contact, with a warning when vague proximity words (`near`, `beside`, `around`) leave the geography free to flip
- **Acting tasks** per character in frame follow `skills/tig-acting-task`: compiled `ACTING TASK — @tag` with **SCENE DIRECTION** (scene event), motive / goal / obstacle / tactic, dialogue-keyed moments, and the eye-life safety line. Scene **physical action** is a line under SCENE CONTEXT. Characters still carry an acting profile and a **locked voice** pasted only where they speak
- **Staging references** (blocking maps) follow `skills/tig-diagram`: schematic outline diagram prompt, `@staging_` connector in LOCATION MAP, and the staging still attached **last** on Generate so photo refs dominate the style vote
- Compiled clip bodies follow the **CINEDANCE / Oneiric** skeleton: **SCENE CONTEXT → ACTIVE REFERENCES → LOCATION MAP (exact positions) → FORMAT MODE → SEGMENT n (LENS + ACTING TASK) → DIALOGUE → AUDIO → STYLE → POSITIVE LOCKS**. Empty blocks (PHYSICS, LIGHTING) are omitted. Beat `cam` becomes the segment label and `LENS:` line; clip-level CAMERA sits under FORMAT MODE. Breakdown copy fills ACTIVE REFERENCES as `@tag: … 100% matches the reference` (locations: architecture/materials/clutter/light only)

### Director tab: Generate page redesign **(in progress)**

- Two-column workspace: the left column is the **production console** — clip identity with generate actions in the title row, 16:9 viewer, takes grouped by Full vs each isolated shot (native / held), and the rewrite notes card; the right column is the **prompt stack** — collapsible sections for the compiled Prompt (fixed 475px scroll box with Copy), manual body edits, Shots (durations + isolation), Setup, Craft (blocking/lens/acting/staging) and Style & constraints
- Variant selection is a **segmented control**: Full multishot · S1 · S2 · S3, with a Held/Native length toggle appearing when a shot is isolated — replacing the old separate beat list + three buttons
- Queue tick sits next to **Generate queued** (also still on Shotlist rows and the structure rail) so the prompt stack starts at the top of the column; Edit body textarea is taller (~320px) so more of the compiled prompt is visible without scrolling
- Generate actions sit in the **title row, top right**: accent **Generate 1A** for this clip, a quiet divider, then the queue tick + **Queued · N** + **Scene N** — no boxed THIS CLIP / BATCH card under the viewer. Hover titles still spell out the scope. The Seedance / queued / scene / show line sits under that cluster.
- Collapses to one column on narrow windows
- **Delete any take** from the takes board: in-chip delete control (always visible on failed/red takes), right-click, or Delete/Backspace. A dark in-app confirm (Cancel / Delete) replaces the browser dialog; live takes warn that they are still generating. Linked media-pool assets are removed with the take **(in progress)**
- Media-pool take names use the paper slate (`1A · T01`, `1A · S1 · T01`) instead of leaking the stored clip id (`S01_1-p0a_S1_T01`). Opening Edit rewrites leftover names and clip folders **(in progress)**

### Director tab: Setup + Look bible chrome **(in progress)**

- **Setup** and **Look bible** are a paired control next to Auto-sync (same treatment as the stage tabs), with line icons instead of emoji and a quiet active state
- Script page **Start over** / **Upload** use the same paired control (line icons, shared pill) as Setup / Look bible; **Run breakdown** stays the accent action
- Setup is a full-width production strip: segmented **Clip length / Aspect / Resolution**, a flattened Adapter select (no native 3D dropdown), and **Generate audio** on the same switch as Auto-sync. **Clip length** here is the source of truth for shotlisting (how long each new clip runs); the duplicate picker next to **Shotlist show** is gone
- Look bible is a two-column sheet: genre chips, film-reference composer, and a drag-and-drop mood board (capped at 6 stills) on the left; **Look notes** as the document on the right with Rewrite / Update from refs in the header
- Left rails share the Script panel's **270px** width (Breakdown scene nav, Shotlist/Generate structure tree) so switching tabs doesn't jump the center column **(in progress)**
- Script scene list: stacked **SC#** over the heading, with card padding and 8px gaps so rows no longer sit on top of each other **(in progress)**
- Script Assistant context: **drag across lines** (or ⌘-click to add) — each script line is its own block, so a normal text highlight couldn't span them; the chip shows **N lines** and those blocks stay tinted **(in progress)**

### Director tab: Shotlist page redesign **(in progress)**

- The Shotlist tab is now a **planning document** (modeled on the Higgsfield HTML shotlist — nothing on this page generates video): an **asset registry** strip up top with element thumbnails, a collapsible **style prefix** section, and every clip as an independently collapsible row — queue checkbox, id/title, running timecode, shots pill and **Copy prompt** in the header; the open body shows element chips, the shotmap and the **full compiled prompt as readable text** (no scroll box). Queue marks feed the Generate tab's "Generate queued"
- **Director's notes per scene**: a notes box under each scene's clips — write freeform notes referencing clips by label ("1A should be a medium close-up · 1B — Peter's tone more angry"), hit **Apply notes with LLM** (or ⌘↵), and the LLM patches exactly the clips the notes mention: framing notes move the lens lock and beat camera language, tone notes rewrite the acting task as behaviour (never emotion adjectives), everything unmentioned stays untouched. Updates land in the structured clip data so the shotmap and compiled prompt both refresh; label-as-id answers are remapped so a sloppy model can't duplicate clips
- **Per-shot isolation on the shotmap** (matches the Higgsfield HTML shotlist interaction): every shot row carries two buttons — hold this shot as one unbroken take for the **full clip length**, or take it at its **own native length** — plus a **Full multishot** reset; isolating rewrites the displayed prompt live (single-take format, camera lock, isolated-prefix rewrite) and the same variant carries over to the Generate tab
- **Clip length lives in Setup**: 10/15/20/30s in the Setup drawer sets shot density for the next shotlist run (existing clips keep their timing); a totals line tracks clips · shots · total runtime as the board fills
- **Per-scene shotlisting**: every scene block has its own Shotlist / Re-shotlist button plus inline scene **event** and **physical action** fields, so a single scene can be (re)broken without touching the rest of the show
- **Compiled prompts match CINEDANCE / Oneiric**: same blocks in the same order (SCENE CONTEXT, ACTIVE REFERENCES, LOCATION MAP, FORMAT MODE, SEGMENT n, DIALOGUE, AUDIO, STYLE, POSITIVE LOCKS). Multi-shot clips are a controlled HARD-CUT sequence; a single beat is a continuous take. Acting compiles as `ACTING TASK —` on the matching segment, with scene direction from the scene event **(in progress)**
- **Single-beat clips compile as held singles**: `ONE CONTINUOUS UNBROKEN TAKE — a cut is a failed take` instead of "one shot with hard cuts", per the CINEDANCE format-mode rule
- **Dialogue discipline compiles automatically**: any clip carrying a quoted line now ships the CINEDANCE audio lock (only scripted lines spoken, lips still when silent, listeners say nothing, ambient ducks under dialogue) in both full and isolated variants
- Shotlist segmentation now knows the **4-second shot floor** (below it the model whips/blends), that a beat needing six angles is two clips, that **held singles are often the strongest 30s material**, and that dialogue cuts land where the power shifts — not at every line
- **ChatGPT Luna as a director LLM**: the picker offers **ChatGPT Luna** (`gpt-5.6-luna` via the Codex CLI). It uses your **ChatGPT Codex quota**, not the cheap API rate — if Codex is rate-limited, pick fal.ai or OpenAI Luna until it resets. Director JSON jobs now skip `~/.codex/config.toml` MCP servers, run in an empty workspace, and send the prompt on stdin so shotlist batches do not boot Linear/Cloudflare MCP or hang on “Reading additional input from stdin”. **(in progress)**
- **OpenAI Luna as a director LLM**: a second picker option, **OpenAI Luna**, runs the same `gpt-5.6-luna` model through the **OpenAI API** (`$0.20 / $1.20` token rate). Add an OpenAI key in Settings; Director JSON jobs go through main-process Chat Completions (`json_object`, low reasoning) so the renderer never hits `api.openai.com` directly. Shotlisting can run up to 3 concurrent API jobs, like fal. A Spend / Tokens / Requests card sits at the bottom of the left rail on **Script, Breakdown, Shotlist, and Generate** (same layout as the LLM tab), priced from each response's token counts (cached input at `$0.02/M`, long-context >272k input at 2×/1.5×). Hover for in/out tokens and the last request. **(in progress)**
- **fal.ai as a director LLM**: the LLM picker now offers **fal.ai — Gemini 2.5 Flash** (via `fal-ai/any-llm`, latency priority) alongside the Claude/Codex/Gemini CLIs — typically much faster than a local CLI round-trip. Enabled whenever a fal key is set in Settings; it also becomes the automatic fallback when no CLI is installed. The Script Assistant chat stays on a CLI (fal has no streaming chat path)
- **Higgsfield as a director LLM (plumbed, gated off)**: the picker shows **Higgsfield — GPT-5 mini** (their `llm_text` model) but disabled with the reason — Higgsfield's CLI cannot run LLM jobs end to end today: pre-1.x builds submit `llm_text` but never print the answer, and CLI 1.1.23's v2-alpha generate path refuses to submit it. Full plumbing (provider, transport via `higgsfield:generate`, `result_json` text extraction, error mapping) is in place behind `HIGGSFIELD_LLM_CLI_SUPPORTED` — one flag flip when Higgsfield ships CLI LLM support
- **Start over is now a real reset**: it clears the script *and* the breakdown, scenes, clips, style prefix, and sync state (library Elements are kept), stops any running CLI job, and drops results from still-in-flight jobs so a late "Shotlisting show…" can't repopulate the cleared board — previously it cleared only the script and the breakdown badge kept its count
- **Full-scene coverage, not highlights**: shotlisting now runs **one LLM call per scene** (each gets the full output budget; clips land on the board progressively), the job input carries only that scene's script slice plus a **coverage target** estimated from its word count (~1 page ≈ 1 min ≈ three 20s clips), and the system prompt mandates walking the scene first line to last — "a nine-page scene needs twenty or more clips, never two". Scenes are written in **small batches** that land on the board as each returns — 3 clips on the first request (fast first paint; measured cost is ~2k output tokens per clip) then 5 per continuation, up to 20 rounds with a 5-minute timeout per call — until the model reports the scene's final line is covered, so long scenes stream in progressively instead of arriving after one giant response. Running status is a short **Shotlisting…** plus **Stop** at the far right of the Shotlist action row — no scene name, part count, or clip estimate
- **Per-scene element scoping + fast CLI model**: every shotlist request now carries only the breakdown elements the scene actually uses (detected by the same matcher that powers breakdown highlighting, plus per-scene AI suggestions and manual overrides; falls back to the full bible when a scene can't be matched) — on a 64-element show this cuts the prompt dramatically for every provider. Claude Code CLI shotlist batches also run on **Haiku** instead of Sonnet, closing most of the speed gap with fal
- **fal.ai shotlist parallelism:** fal shotlisting now runs **up to 3 Gemini Flash jobs at once**. A ~12-clip scene is split into chronological script slices that generate in parallel (clips still land in scene order); **Shotlist show** shoots every scene concurrently instead of waiting for scene 1 to finish. CLI/Higgsfield stay sequential (one local process). Slice splits follow screenplay lines (not blank paragraphs) so a dialogue scene cannot collapse into one 60s 13-clip job. **(in progress)**
- **New clips no longer orphan on arrival**: the shotlist LLM answers with invented scene ids ("scene-1") while the deterministic breakdown assigns real ones — the merge now remaps every incoming clip onto the existing scene (by id, then heading, then scene number, then the clip-id prefix), the job input hands the LLM the real `[sceneId: …]` values, and the system prompt forbids inventing ids. Previously every fresh shotlist run produced clips pointing at nonexistent scenes — invisible on the board and counted only by the totals
- **Zero-click flow actually works now**: auto-sync's scoped shotlist runs used to shotlist only the FIRST changed scene — on a fresh script upload that meant one scene got clips and the rest silently stayed empty; every changed scene is now shotlisted. A failed LLM breakdown stops the chain (no shotlist against an empty bible), the run stays dirty for retry on the next edit, and the Shotlist page shows live status ("Shotlisting 3 scenes…") and surfaces auto-sync errors with a fix hint instead of failing silently. Shotlist buttons no longer wait for breakdown approval

### LLM tab: Acoustic-emotional clip analysis **(in progress)**

- Copilot can now analyze the **audio performance** of each clip (vocal delivery, emotion, energy, pacing) and detect **silence boundaries**; results are stored per-asset and joined into the project insight index so chat can answer performance questions with real timecodes
- **Local Gemini CLI is the primary transport** (no API key, hears the audio track via inline `@path` attach); falls back to **fal.ai `video-understanding`** only when Gemini CLI is unavailable or declines the media (and a fal key is set)
- **"Analyze entire project"** button batch-runs ingest across the media pool, showing `Analyzing {done}/{total}…` progress; status persists per asset so a re-run resumes where it left off
- Speechless b-roll clips get **content / shotType / cutawayCandidate** descriptors instead of vocal-delivery fields

### LLM tab: Performance-aware selection **(in progress)**

- Moment retrieval now reads the acoustic **emotion / energy / pace / delivery** descriptors instead of keyword matching alone, **specialized per editorial persona** (a documentary editor surfaces reflective/measured takes; a promo-trailer editor surfaces high-energy ones) — deterministic and a strict superset of the old keyword behavior
- New **story-shape map** (narrative arc beats + emotional climax) and **repetition/contradiction map** (catches duplicate takes and conflicting statements) on the project index, surfaced in chat context and as **"arc:" / "N duplicate moments"** stats in the Copilot topbar
- Optional **LLM re-rank** of the top candidates when a non-auto quality goal is set; any failure falls back to the heuristic order, so cut generation can't regress

### LLM tab: Human-feeling cuts **(in progress)**

- New **"Humanize cut"** toggle (off by default): when on, generated cuts **snap their boundaries to the analyzed silence/breaths** instead of landing mid-word, add small **room-tone handles** so cuts breathe, and create **J/L cuts** (audio trails the picture) where the source has handle and there's adjacent silence
- Boundary math is fully clamped — never shrinks a clip below a floor, never trims past source, never crosses a neighbor — and is the first consumer of the Phase 1 objective silence map
- With the toggle off, generated-cut output is **byte-for-byte unchanged** (guarded by a no-regression snapshot test)

### LLM tab: Copilot app actions **(in progress)**

- Copilot can apply changes across CineGen via **`cinegen-skill-action`** buttons: **`add_nodes`** (prompt/model nodes to active or named Spaces workspace), **`save_elements`**, **`edit_timeline`** (split/trim/remove clips, close gaps, add markers), plus existing **`create_space`** workflows
- **Prompt / node requests** ("give me a node for shot 13") show a one-click **Add to [workspace]** button — client infers the action even when the model only asks in text
- **New chat empty state:** Claude Code, Codex, Gemini CLI, and Local modes now show the message composer on the landing screen (previously only Cloud did) **(in progress)**
- Project context now includes **active Spaces workspace** and workspace list so Copilot knows where nodes will land

### LLM tab: Skill Builder **(in progress)**

- **Skill Builder** sparkle button in the **main top nav**, immediately left of Settings (LLM tab only)
- Each skill has a **name**, **description** (when Copilot should use it), and **markdown instructions** injected into the system prompt when active
- **Skill selector** in the composer — **Shift+Space** opens the skill picker; selected skills insert as `#skill-name` tags in the reply field (same highlight treatment as `@` elements and `/` assets)
- **11 built-in default skills** auto-seed on first load: **shot-list**, **storyboard**, **shot-list-video**, **editorial-brief**, **rough-cut**, **remove-dead-space**, **prompt-writer**, **selects-highlights**, **b-roll-planner**, **delivery-prep**, **character-look-bible** — each tagged with surfaces (`llm`, `spaces`, `edit`, `elements`, `export`) and action instructions for cross-tab workflows
- **Import / export** via SKILL.md (YAML frontmatter + markdown body); skills stored app-wide in localStorage
- Active skill highlighted in main nav, sidebar, and skill list
- **AI skill authoring:** **New skill → Build with AI** opens a guided Q&A; uses installed CLI first (Claude Code / Codex / Gemini), then Cloud or Local
- **Chat skill authoring:** ask Copilot to “create a skill for …” — same guided flow in chat with a **Save skill** button when the draft is ready
- **Skill → Spaces actions:** shot-list outputs a formatted list only; **Create storyboards** / **Create videos** fork buttons launch **storyboard** or **shot-list-video** skills; Spaces workspaces use **one wired row per panel/clip** (Prompt → Nano Banana 2 / Seedance 2 / Kling 3 → Asset Output), not a single Multi Prompt node; **shot-list-video** supports intelligent durations and optional shot combining (Seedance up to 15s) **(in progress)**

### LLM tab: Background Copilot **(in progress)**

- Copilot **keeps running when you switch tabs** — LLM tab stays mounted in the background so streaming and in-flight requests continue while you work in Spaces, Edit, or Export
- **LLM nav indicator** while Copilot is thinking (pulsing dot) and when a response is **ready** (green dot) after you navigate away
- **In-app toast** (bottom-right) when a background reply finishes — **View** opens the LLM tab; auto-dismisses after 8s; **skipped on errors** (e.g. CLI exit failures)
- **Desktop notification** when a background reply finishes (macOS/Windows system notification, if allowed)
- Unread indicator clears when you return to the LLM tab

---

### LLM tab: CLI LLM detection (Claude Code, Codex, Gemini CLI) **(in progress)**

- Copilot scans for **Claude Code**, **Codex**, and **Gemini CLI** on startup (`~/.local/bin`, `~/.npm-global/bin`, Homebrew, PATH)
- Each installed CLI appears as its own backend toggle and model group in the unified picker
- Subscription CLI chat, context caching, Enhance Prompt, and token stats work across all detected CLIs
- Uses your Claude subscription — no fal.ai API key or token billing
- Sends full chat history plus project context (assets, transcripts, timelines, elements) on each message
- Streams responses back into the Copilot chat UI in real time
- Unified **Model** dropdown in composer and Settings lists Cloud, Local, and Claude Code models — selecting one switches backend automatically
- Collapsed model chip shows **`provider: model`** (e.g. `claude: opus`); open menu uses grouped short labels (Claude / Codex / Gemini / Cloud / Local)
- Sidebar and top bar show **Input / Output / Tokens** for CLI backends (Claude Code, Ollama) instead of API spend; per-message token counts included
- Gemini CLI model picker uses CLI-native aliases (`auto`, `flash`, `pro`) plus Gemini 3.1/3 preview IDs — not pinned to 2.5 only
- **Gemini CLI Copilot speed:** default model is **gemini-2.5-flash** (was `auto`); compact project context, stable Gemini workspace dir (fixes resume errors), headless **default** approval mode, 90s first-token timeout with visible tool status while waiting **(in progress)**
- **Gemini CLI visual timeline analysis:** questions like “describe the first clip in the timeline” auto-attach the clip via inline `@/path/to/clip.mp4` (same as terminal Gemini CLI), auto-approve `read_many_files`, skip CineGen project metadata on visual turns, and export trimmed clips with **video + audio** via ffmpeg — no fal.ai fallback **(in progress)**
- **Gemini CLI visual `/` references:** `/asset` or `/clip` mentions attach local image/video files the same way **(in progress)**
- **Generated media local persist:** AI outputs and remote-only pool assets auto-download/copy into `{project}/media/generated/` on project load and when added; sets `fileRef` + `sourceUrl` and queues metadata/thumbnail/filmstrip jobs **(in progress)**
- **Enhance Prompt:** works with Cloud, Local (Ollama), and CLI backends; rewrites composer text only (does not answer the question — use Send for that)
- **Claude Code model picker:** Opus, Sonnet, and Haiku via `--model`
- **Smart context caching:** full project context injected on first message only; follow-ups use `--resume` session (much lower token use)
- **Auto context refresh** when assets/timelines/transcripts change, or when Claude indicates missing project info
- **Copilot chat guardrails:** Claude Code runs with **all tools disabled** (`--tools ""`) so it answers from injected project context instead of invoking MCP/plugin tools or searching the CineGen repo on disk
- **Timeline clip list formatting:** chronological numbered list with clickable `[timeline:…]` citations; repeat questions stay in list format with auto-retry if a table slips through
- **GFM markdown tables:** Copilot chat renders GitHub-flavored markdown tables (via `remark-gfm`) with scrollable styled table blocks

**Requirements:** Install Claude Code from [code.claude.com](https://code.claude.com) and sign in once via Terminal (`claude`). Restart CineGen after install.

---

### Spaces canvas file drop **(in progress)**

- Drag image, video, or audio files from your desktop onto the Spaces canvas to create **File Upload** nodes at the drop position
- Supports multi-file drop (each file becomes its own node, slightly offset)
- Uses local file paths in Electron via `webUtils.getPathForFile` (no cloud upload needed for desktop files)
- Dashed highlight appears while dragging files over the canvas

**Bug fix:** Dropped files no longer fall back to fal.ai upload when a local path is available (fixes failures when fal balance is exhausted).

---

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

### Elements: multi-select and bulk delete **(in progress)**

- **⌘/Ctrl-click** toggles cards into a selection; **Shift-click** selects a range; drag a marquee across the grid to grab several at once
- Dragging across cards no longer highlights names with the native blue text selection
- Right-click the selection for **Delete** (or Delete/Backspace); a confirmation names the elements before they are removed
- Plain click still opens the editor; bulk delete is one undo step

### Global Elements library **(in progress)**

- Elements are shared across every project (stored in `Documents/CINEGEN/elements-library.json`) instead of locked to one show
- Existing per-project elements migrate into **folders named after their project** on first load
- The Elements page has **All** / **Unfiled** / per-project folders, plus **New folder**; right-click a card to move it, double-click a folder to rename
- New elements created from **All** land in the current project's folder so the library stays organized as you work

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

### Director Generate takes **(in progress)**

- Takes on Generate are grouped by **Full** vs each isolated shot (`S1 · 7s` native, `S1 · 20s held`) so you can see isolate takes without clicking the shot then Held/Native
- Clicking a take (or its group label) jumps to that variant; Full / S1…S5 buttons show take counts. Held/Native still chooses what Generate produces next
- Generating is a monitor overlay (REC, take slate, render bar) instead of faded **Generating…** text on a black frame; the take chip pulses while that take is live
- If Higgsfield finishes while CineGen still shows **Rendering**, Generate rejoins the job (`generate get` / recent video list) and attaches the mp4 instead of leaving T01 stuck — including the **web** Higgsfield service (`generateList` / get without wait). The overlay has **Load from Higgsfield** if it is still catching up

---

## Bug Fixes

- **FLUX 2 Max:** Wrong endpoint slug (`flux-2/max` → `flux-2-max`)
- **Kling First & Last:** `tail_image_url` was sent to an endpoint that ignored it
- **SAM 3 Track:** Response mapping pointed at non-existent `segmented_video.url`
- **ElevenLabs STT:** `language` renamed to `language_code` to match API
- **Nano Banana 2:** Removed unsupported `seed` parameter
- **Layer Decompose:** `reconstruct_bg` kept as app-only (not sent to SAM 3 API)
- **KIE Runway:** Quality param no longer stripped before API call **(in progress fix)**
- **Gemini CLI Copilot hang / resume:** Headless chat uses a stable app workspace (fixes `No previous sessions found for this project` on follow-ups); `/clip` and `/asset` refs attach local media for visual Q&A **(in progress)**
- **Claude Code Copilot exit 1:** Use `--tools ""` (disable all tools) instead of a partial deny list — MCP/plugin tools were still callable, hitting `--max-turns 1` with no reply text; clearer errors from CLI `result.errors` **(in progress)**
- **Claude Code Director shotlist hang:** JSON jobs (`shotlist`, breakdown, look bible) no longer inherit the CineGen repo as cwd. They spawn in an empty userData workspace with `--safe-mode` (OAuth still works) and `--effort low`, replace the default coding system prompt, and stop duplicating that prompt into the user message. Copilot chat is unchanged. The web CLI allowlist now accepts purpose `json-job` (it previously rejected shotlist as “CLI chat purpose is invalid”). Shotlist CLI runs now land **1 clip on the first round** (fal still does 3) and **resume the same Claude session** for later batches so Haiku isn't cold-starting 15k tokens of doctrine every round — the board staying at `0/~12` for 100s was that first 3-clip JSON blob, not a hang. **(in progress)**
- **Claude Code max turns:** Raise Copilot to `--max-turns 2`, disable slash commands, auto-retry with fresh context on max-turn failures; `#skill-name` in a message loads that skill into the prompt **(in progress)**
- **Copilot skill inventory:** Inject **CineGen SKILLS** catalog into system context; auto-retry when Claude deflects with “let me check / use Skill tool” instead of listing skills **(in progress)**
- **Director breakdown remove:** ✕ on a side-panel card already hid it from that scene’s assets; the script highlight now uses the same per-scene list, so the mark in the script goes too **(in progress)**
- **Director FDX trailer:** `.fdx` import only reads the `<Content>` script block, so Final Draft `ElementSettings` / `FontSpec` / `ParagraphSpec` chrome no longer appears after `CUT TO:`. Already-open shows are scrubbed on load; a `.txt` that is actually FDX is sniffed and parsed the same way **(in progress)**
- **Director Generate looked dead:** clicking Generate could no-op when no clip id was stored, hide a failed Higgsfield take as “No take yet”, and wait on character enrich before any UI. Failed takes now show the CLI error; Generate starts immediately via Higgsfield CLI (`higgsfield` / `higgs`) **(in progress)**
- **Seedance 2.5 unknown params:** Generate no longer sends `genre` or `multi_shots` — the live Higgsfield CLI dropped those flags. Genre and shot list stay in the prompt; CLI args are filtered to the current `seedance_2_5` schema **(in progress)**
- **Higgsfield 503 during Generate:** a 503 while polling no longer kills a job that already landed. CineGen submits, then `generate wait` / `get` the job id and retries transient errors; the Generating spinner clears if the job really failed **(in progress)**
- **Generate stuck on Rendering:** a take no longer stays “rendering” after Higgsfield has the mp4. CineGen stores the job id, fetches completed jobs (web `higgsfield.generateList` + `generate get`), and attaches the video; recovery retries instead of giving up after the first miss, and the overlay can **Load from Higgsfield** **(in progress)**
- **Director element stills on Generate:** isolated prompts include `ACTIVE REFERENCES`, and tagged library stills are sent to Seedance 2.5 as `omni_reference` `--image` refs so identity is locked to Peter / Jordan / locations, not invented from text **(in progress)**
- **Generate take player:** the video fills the 16:9 viewer instead of sitting in a 240px-tall postage stamp with black padding **(in progress)**

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
