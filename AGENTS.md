# AGENTS.md

Guidance for AI agents working in this repository.

## What this project is

A local-first, browser-based qualitative-data-analysis (QTA) transcript tool.
Load a `.vtt` transcript (video/audio optional, deferred), highlight spans,
tag/annotate them, export CSV. Full product plan: `plan.md` (authoritative for
architecture and schema decisions — read it before making design changes).

- **Slice 1 (shipped) + slice 2 "going multimedia" (current scope):** slice 1
  is transcript-only annotation; slice 2 adds optional paired video/audio
  (stem-matched at import, video preferred), click-to-seek playback, a
  collapsed-by-default player, and a media-off toggle. See plan §10.
- **Stack (decided, plan §3):** SolidJS + Vite + TypeScript, DuckDB-WASM with
  OPFS persistence. Fallback to Preact only if Solid proves blocking.

## Layout

- `app/` — the application (the only buildable code)
  - `src/lib/vtt.ts` — VTT parser (pure, unit-tested)
  - `src/lib/media.ts` — media pairing helpers (stem matching, video/audio
    classification; unit-tested)
  - `src/lib/db.ts` — DuckDB-WASM setup, schema (plan §5), all SQL
  - `src/lib/store.ts` — Solid store + actions; the only module components
    talk to for state
  - `src/components/` — `TranscriptView`, `Tray`, `ImportDialog`, `MediaPlayer`
  - `e2e/smoke.mjs` — Playwright smoke test (needs `vite build` first)
- `spike/` — DuckDB-WASM+OPFS feasibility spike; `spike/FINDINGS.md` documents
  persistence gotchas. Not part of the app; don't import from it.
- `sample-data/` — real Google Meet VTT exports + media used by tests

## Commands

Run everything from `app/`:

```sh
npm install
npm run dev      # dev server at http://localhost:5200
npm run build    # production build to dist/
npm test         # vitest (VTT parser unit tests)
npm run e2e      # playwright smoke e2e — run `npm run build` first
npx tsc --noEmit # typecheck (no separate lint is configured)
```

## Non-obvious gotchas

- **DuckDB-WASM version must stay pinned** to `@next` (≥ 1.33.1-dev64) or
  `1.32.0`. npm `latest` (dev57) silently creates OPFS files but never writes
  to them. After any upgrade, re-run the e2e persistence step.
- **Durability requires `CHECKPOINT`.** Browser tabs don't close cleanly;
  every mutating DB method ends with `checkpoint()`. Don't remove these.
- **Persistence API is `db.open({path: 'opfs://…'})`**, not
  `ATTACH 'opfs://…'`. `db.dropFiles()` deletes the file outright.
- **One exclusive OPFS handle per file** — only one tab may hold the DB open.
- **Folder access is Chromium-only** (File System Access API); the file-input
  fallback exists and is what the e2e test drives.
- **Arrow row access**: alias every column in SQL to quoted camelCase
  (`AS "transcriptId"`) and read rows by that key; cast UUIDs/timestamps to
  VARCHAR in SQL rather than converting Arrow types in JS.
- **SQL is built by string interpolation** — always pass values through
  `esc()` (db.ts) for anything user- or file-derived.
- **Re-import policy (plan §3.5):** imports are one-directional and manual;
  a re-import creates a *new* transcript row, the old data stays. Never
  dedupe or overwrite transcript rows on import.
- **Whole-segment highlights only** (plan §9.4): char-offset columns exist and
  are written as `0`; sub-segment precision is a future UI-layer change.
- **`highlight_text` for multi-segment highlights joins cue texts with `\n`**
  (preserve cue breaks — question/answer pairing matters downstream).
- **Media pairing** matches `baseStem(name)` (extension stripped, `.transcript`
  suffix stripped, lowercased). Media file *handles* don't persist across
  sessions — the DB stores the name only, and `MediaPlayer` shows an attach
  prompt when the transcript has a media name but no in-session file.
- **e2e asserts through rendered UI**, not DB internals: notes only render in
  the expanded editor, so a card must be clicked before asserting note text.
  Media e2e uses a generated 70s WAV (in tempdir) because headless Chromium
  can't be relied on for AAC/H.264; seek assertions are against real cue
  timestamps (segment index 5 starts at 40.1s in the sample).
- The e2e test wipes its own browser profile (`.pw-profile`) but the browser
  storage it exercises is per-origin: run tests against the built `dist/` on
  localhost:5200 (the port is fixed in vite.config.ts).

## Known open issue (as of last session, branch `slice-2-going-multimedia`)

**WIP: library view + recording delete.** The Library tab (list all
transcripts with highlight/note counts, delete) is built and committed as WIP,
but the e2e smoke test fails at the delete step: the first DELETE statement
hangs silently (worker never responds, no error surfaced) — but only in the
e2e's exact third-browser-session flow. Every isolated reproduction passes:

- in-memory deletes, OPFS deletes, full schema + 500 segments, multiple
  reopen/checkpoint cycles: all pass (`spike/delete-full.js`)
- the same delete probed inside the live app in a single session: passes
  (`app/e2e/debug-delete.mjs`)

Debug tooling left in place (all temporary, remove when resolved):
- `db.ts` uses `ConsoleLogger(INFO)` and exposes `window.__qtaDebug`
  (raw `query`, `newConnection`, `reopen`) — the reopen probe was never
  completed; that's the next thing to try (does a fresh worker unstick it?)
- `store.deleteTranscript` / `db.deleteTranscript` carry DELETE_DBG / DEL step
  console.debug instrumentation
- `app/e2e/debug-delete.mjs` is the focused repro/probe script (last run
  crashed on a script bug after `page = page3`, fixed; unverified since)
- e2e smoke has console logging + STALE CONTEXT dump at the delete assertion

Unproven hypotheses: state accumulated across 3 OPFS session cycles in the
app; the export `COPY` → JS `removeEntry` interaction; something in
`transcriptStats`/`listTranscripts` before the delete. The `query()` helper
has no timeout — a hung worker promise waits forever; consider a watchdog
that recreates the worker and retries once.
