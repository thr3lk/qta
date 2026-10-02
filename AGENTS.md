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
  The checkpoint must run *before* any `return` — an unreachable
  `await checkpoint()` after `return` silently skipped durability for new
  highlights and tags once (found via e2e persistence failure).
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
- **Sub-segment highlight precision** (upgrades plan §9.4): selections record
  exact char offsets into the boundary segments (`start_char_offset`,
  `end_char_offset`); middle segments of a multi-segment highlight are fully
  covered. Conventions (see `src/lib/highlight.ts`): offset 0 = "from the
  start" / "to the end"; rendering splits each segment into atoms at
  highlight boundaries (`splitAtoms`) so overlapping partial highlights nest
  correctly. A selection that starts at a segment's last char or ends at its
  first char shrinks out the empty boundary segment. Legacy rows stored as
  0/0 keep rendering as whole segments.
- **`highlight_text` for multi-segment highlights joins cue texts with `\n`**
  (preserve cue breaks — question/answer pairing matters downstream). The CSV
  export goes further: `highlight_text` is speaker-marked (each speaker's
  portion prefixed `[Name] `, boundaries sliced by char offsets) and the
  `speakers` column is a JSON array of display names covering the highlight
  (replaces the old single `speaker_display_name`). Portioning is derived at
  export time from segments + offsets (`speakerMarkedText`/`spanSpeakers` in
  `src/lib/highlight.ts`) — no annotation schema change; rows are staged in a
  DuckDB temp table and written with `COPY` so quoting stays native.
- **Media pairing** matches `baseStem(name)` (extension stripped, `.transcript`
  suffix stripped, lowercased). The DB stores the media *name* only; the file
  itself is persisted as a blob in IndexedDB (`qta-media`, keyed by
  transcript id — see `src/lib/mediaStore.ts`) and restored automatically on
  `openTranscript`. If no blob is stored (e.g. fresh browser profile), the
  player shows the attach prompt instead. Orphan blobs are pruned on boot;
  deleting a transcript deletes its blob.
- **Highlight-select playback behavior** is a user preference ("On select" in
  the tray header): `play-from` (seek + autoplay, the default),
  `go-to` (seek, paused), `play-only` (seek + autoplay, pause at the
  selection's end). Stored in `localStorage` (`qta.playbackMode`). The mode
  governs every selection surface: tray cards, transcript clicks on a segment
  covered by exactly one highlight, and plain unhighlighted segment clicks
  (range = that segment). Segments with 2+ highlights still seek per mode to
  the segment range and open the chooser; picking from the chooser applies the
  mode to that highlight. All paths go through `playRange` in `store.ts`
  (`goToAnnotation`/`goToSegment`); controller `seek(ms, opts)` clears any
  pending `play-only` stop boundary on manual play/pause or scrubbing.
- **e2e asserts through rendered UI**, not DB internals: notes only render in
  the expanded editor, so a card must be clicked before asserting note text.
  Media e2e uses a generated 70s WAV (in tempdir) because headless Chromium
  can't be relied on for AAC/H.264; seek assertions are against real cue
  timestamps (segment index 5 starts at 40.1s in the sample).
- The e2e test wipes its own browser profile (`.pw-profile`) but the browser
  storage it exercises is per-origin: run tests against the built `dist/` on
  localhost:5200 (the port is fixed in vite.config.ts).

## Resolved: library delete "hang" (branch `slice-2-going-multimedia`)

The e2e delete-step failure reported last session had two overlapping causes,
neither of them an actual silent DuckDB hang in the end:

1. **UI bug (fixed):** `App.tsx` rendered the welcome screen as the `<Show>`
   fallback whenever the view wasn't `review`, so `welcome-import` existed the
   moment the Library tab opened. The e2e's "wait for welcome" step therefore
   passed instantly and asserted while the delete was still in flight, reading
   as "delete hung / recording still listed". Rule: the welcome screen renders
   only when `state.phase === "welcome"`; don't use view-switching `<Show>`
   fallbacks that leak across tabs.
2. **Flaky DuckDB-WASM worker unresponsiveness (mitigated):** across many
   restart/export cycles the worker occasionally stops answering queries.
   Root cause in duckdb-wasm/OPFS not identified; isolated repros never catch
   it. `db.ts` now has a watchdog: every `query()` races a 10s timeout, and on
   timeout the worker is terminated, the database reopened, and the query
   retried once (retries are safe: all mutating flows are idempotent deletes/
   inserts keyed by fresh UUIDs). If you see `qta: database worker
   unresponsive` in the console, the watchdog fired and recovered.

