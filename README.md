# CineGen

CineGen is a Tauri + Rust-first AI-native video editor prototype implementing the v1.1 engineering handoff and UI contract.

## What is implemented

- `Generate / Edit / Export` tabbed desktop UI (React + TypeScript)
- Typed RPC-style UI ↔ engine contract (`project.*`, `timeline.*`, `history.*`, `ai.*`, `media.*`, `export.*`)
- Event stream contract (`PlaybackStateChanged`, `TimelineSelectionChanged`, `HistoryUpdated`, etc.)
- Per-project workspace persistence (active tab, panel tabs/sizes, zoom states)
- Edit workspace with classic NLE 5-region layout
- Proposal preview drawer with atomic apply/reject flow
- Generate workspace with prompt clips, output cards, queue, and timeline handoff
- Export workspace with presets, advanced drawer, and background sequential queue
- Responsive behavior for `>=1440`, `1200-1439`, `<1200` breakpoints
- Dark-first theme with light toggle and keyboard-focus visibility

## Rust engine workspace

`crates/cinegen-engine` includes v1.1 core contracts and test scaffolding:

- Tick time model (`Tick = i64`, `Timebase = 240_000 ticks/sec`)
- Deterministic frame/tick conversion helpers
- Sequence graph model using `*_tick` fields
- Formal event envelope with idempotency and commit lineage fields
- Provider interface with required methods + capabilities contract
- Retry/failure policy (max retries, backoff, retryable classes)
- Linked-folder stability logic (debounce + stable checks)
- Deterministic replay harness
- SQLite migration SQL for commits/events/snapshots/assets/jobs/semantic tables

## Run

```bash
pnpm install
pnpm dev
```

## Run Desktop (Tauri)

```bash
pnpm install
pnpm tauri:dev
```

Desktop app window will launch with the same UI and behavior.  
Current desktop bridge uses fallback mock engine behavior until native `engine_invoke` wiring is completed.

## Validate

```bash
pnpm lint
pnpm build
cargo test -p cinegen-engine
```

## Notes

- In browser/dev mode, the app uses `src/engine/mockEngine.ts`.
- If Tauri runtime is available, `src/engine/index.ts` uses Tauri transport via `engine_invoke` and `engine_event`.
