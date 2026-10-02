# QDA Transcript Highlighter — Planning Document (v0.1)

## 1. Purpose & Framing

A lightweight, local-first tool for qualitative researchers: point it at a folder of recording files and get a Descript-style interactive transcript editor for making, tagging, and exporting highlights. A folder may contain any number of files, but the tool reviews **one transcript (or transcript + media pair) at a time**. The `.vtt` transcript is mandatory; a video or audio file is optional. If both a video and an audio file are present for the same transcript, prefer the video.

This is explicitly **v1 of a component**, not a standalone product. The eventual target is a project-level tool where highlights from *many* transcripts live in one shared space and get cross-analyzed. Every design decision below should ask: "does this box me in when I add transcript #2?" That constraint drives most of the schema and architecture choices, even though today's scope is one video + one VTT.

## 2. Scope for this Iteration

**In scope** (sliced so the first build ships transcript-only; media comes later):
- Load a `.vtt` file from a folder. The folder may contain other unrelated files; the user selects which transcript to open.
- Render an interactive, scrollable transcript as the primary UI.
- Select text spans in the transcript to create highlights.
- Highlights can overlap.
- Highlights carry tags, freeform notes, and arbitrary key/value properties.
- Attach an optional paired video or audio file (video wins if both are present); clicking a highlight or transcript region plays/seeks it. Media is secondary and hidden/collapsed until needed, with a toggle to hide it entirely and work transcript-only. *(Deferred to a later slice — see §10.)*
- A margin "tray"/drawer lists highlights and supports working with them (filter, edit, delete, jump-to).
- A "highlights-only" view (transcript stripped down to just the highlighted spans, in order).
- Each highlight has a stable URI that deep-links to and focuses that transcript region.
- Speakers are auto-tagged (Speaker 1, Speaker 2, ...) from the VTT, renameable in the UI, and have a stable internal ID independent of display name.
- Export highlights to CSV.
- Underlying store is DuckDB, with a schema that anticipates multi-transcript, multi-project use.

**Explicitly out of scope for now (but named so the schema doesn't foreclose them later):**
- Multi-transcript project workspace / cross-transcript highlight boards.
- Multi-user / real-time collaboration.
- Automated speaker diarization or transcription (we consume an existing VTT; we don't generate one).
- Video editing/export (no clip rendering, no re-encoding).
- Auth, sync, cloud storage.

## 3. Architecture

### 3.1 Decided shape: browser-based local-first SPA, DuckDB-WASM as the file-backed store, SolidJS frontend

The tool runs entirely in the browser (no install, no server round-trips) but must become a multi-project tool later. The stack:

- **Runtime:** pure browser app. Folder access via the File System Access API; persisted data via OPFS (see §3.4).
- **Frontend:** **SolidJS**. Fine-grained reactivity is a good fit for a transcript view that updates individual segments/spans in place at high frequency without a VDOM diffing over hundreds of cues. If Solid proves difficult (ecosystem gaps, awkward patterns for the selection/highlighting work), fall back to **Preact** — the data layer and schema are framework-agnostic, so the switch cost is contained to the view layer. Transcript view is the dominant, most complex piece of UI — treat it like a text editor component, not a simple list (see §6).
- **Media:** native `<video>` or `<audio>` element (per what's available), hidden/collapsed by default, driven programmatically (seek + play) from transcript/highlight interactions. A toggle disables media entirely; the tool must be fully usable transcript-only. No custom media engine needed for v1.
- **Data store:** **DuckDB-WASM** reading/writing a `.duckdb` file persisted in OPFS, logically "alongside" the loaded source files. This keeps each "project folder" self-contained and portable — a real asset when this becomes a multi-transcript tool, since a project is just "a folder of these folders."
- **VTT parsing:** parse once on load into an in-memory cue list, and persist a normalized copy into DuckDB (`transcript_segment` table, §5) so the DB — not the VTT file — becomes the source of truth for anything the user has touched (speaker renames, etc.). Keep the original VTT untouched on disk as raw source.

### 3.2 Why DuckDB fits here

- SQL over highlights means "give me all highlights tagged X across every transcript in the project" is a `WHERE` clause, not custom code — this is the feature that matters most once you're multi-transcript.
- Embeds as a file, no server process, matches the local-first / one-folder-per-session model.
- Exporting to CSV is native (`COPY ... TO 'file.csv'`), so the CSV export requirement in §2 is close to free.
- Good fit for the eventual "many transcripts, one workspace" step: each transcript folder can keep its own DuckDB file, or all transcripts in a project can share one DuckDB file with a `transcript_id` foreign key — the schema in §5 is written to support either without a rewrite.

### 3.3 Alternative worth flagging

A simpler v0 could skip DuckDB and use SQLite (via sql.js/wasm-sqlite) or even a JSON sidecar file. I'd push back on JSON (no query surface, painful once cross-transcript queries matter) but SQLite-WASM is a legitimate lighter-weight alternative if DuckDB-WASM proves problematic (bundle size, OPFS quirks). Recommend keeping DuckDB unless it turns out to be a real headache, since the SQL-analytics use case (cross-transcript queries) is exactly DuckDB's strength over SQLite.

### 3.4 Chosen: pure web app

This is the decided path (§9.1 resolved). Storage adapter is **DuckDB-WASM** running in-browser, backed by the Origin Private File System (OPFS) for durable storage between sessions. Source files (VTT, media) are read per-session via the File System Access API, which is Chromium-only — Firefox/Safari users would need a file-picker fallback flow. The browser sandbox means the user grants folder access each session; that's the accepted tradeoff for distribution-without-install.

**Spike validated — see `spike/FINDINGS.md`.** Key constraints carried into build:
- **Pin `@duckdb/duckdb-wasm@next` (≥ dev64) or `1.32.0`** — npm `latest` (dev57) silently creates OPFS files but never writes to them.
- Persistence API is `db.open({path: 'opfs://…'})`; durability requires a SQL `CHECKPOINT` after write batches (no reliable clean shutdown in a browser tab; `flushFiles()` is not the durability mechanism).
- One exclusive OPFS handle per file ⇒ one tab can have the DB open at a time.
- Bundle: `eh` wasm ≈ 8 MB gzip — lazy-load it behind a loading state; ship only the `eh` bundle, not both `mvp` + `eh`.

### 3.5 Import and re-import policy

The workflow is one-directional: **read the VTT, import it into the database, then work off the database.** The VTT file is raw source material, never re-read automatically.

- **Re-imports are manual and discouraged.** No automatic re-sync when a VTT file changes on disk.
- A re-import creates a **new transcript row** (new `transcript_id`) in the same DuckDB file; the previous import's data stays in place, untouched.
- Known consequence: annotations on a superseded import become **orphans** — their `transcript_id` no longer corresponds to anything the user is actively working with. Detecting/merging/re-parenting orphaned annotations is a deferred problem; the only requirement now is that nothing gets deleted, so orphans remain queryable later. The schema already satisfies this.

## 4. Core Concepts (Domain Model)

| Concept | Definition |
|---|---|
| **Transcript** | One VTT file + its metadata (participant, session date/time, interviewer, topic). Maps to an optional video or audio file in this iteration. |
| **Segment (cue)** | One VTT cue: a speaker turn or sub-turn with a start/end timestamp and text. This is the atomic unit the transcript view renders. |
| **Speaker** | A stable entity with an internal ID, independent of display name. A segment references a speaker ID, not a name. |
| **Highlight** | A user-created span over one or more segments (or a sub-span of text within/across segments), with a time range derived from its underlying segments. Highlights can overlap arbitrarily. |
| **Annotation** | The generalization of a highlight: a highlight *is* an annotation with a required span. Annotations carry tags, notes, and arbitrary key/value properties. (Modeling highlights as a kind of annotation, rather than a separate thing, is what lets "notes and other arbitrary properties" bolt on cleanly — see §5.2.) |
| **Tag** | A short label, many-to-many with annotations. Global to the project (not per-transcript), since cross-transcript tag analysis is the whole point later. |
| **Project** *(future)* | A collection of transcripts. Not built now, but the schema's `transcript_id` foreign keys exist specifically so wrapping multiple transcripts in a project later is additive, not a migration. |

## 5. Data Model (DuckDB Schema)

Design principle: **every table that will eventually span multiple transcripts already has a `transcript_id` column**, even though today there's only ever one row in `transcript`. This is the main hedge against the "core feature of a larger multi-transcript tool" requirement.

### 5.1 `transcript`
One row per transcript in this iteration; will hold one row per file once multi-transcript lands.

| Column | Type | Notes |
|---|---|---|
| `transcript_id` | UUID (PK) | Stable ID, generated on import. |
| `source_vtt_path` | VARCHAR | Original file *name* (see §8 portability note — browser file access yields names, not paths). |
| `source_media_path` | VARCHAR | Optional paired video or audio file *name* (browser: no real paths exist; File System Access API handles aren't persistable across sessions). Null when transcript-only. |
| `participant_name` | VARCHAR | Editable metadata. |
| `interviewer_name` | VARCHAR | Editable metadata. |
| `session_datetime` | TIMESTAMP | |
| `topic` | VARCHAR | |
| `duration_seconds` | DOUBLE | Derived from video/VTT on import. |
| `created_at` | TIMESTAMP | |
| `custom_metadata` | JSON | Escape hatch for any project-specific metadata field not worth a dedicated column. |

### 5.2 `speaker`
Stable identity, decoupled from display name — directly satisfies the "same speaker ID across multiple transcripts" requirement.

| Column | Type | Notes |
|---|---|---|
| `speaker_id` | UUID (PK) | Stable, never changes. |
| `transcript_id` | UUID (FK) | Which transcript this speaker-slot was first seen in. *(Cross-transcript speaker matching — e.g. "this is the same interviewer across 12 sessions" — is a real future need; flagged as an open question in §9 rather than solved now.)* |
| `raw_label` | VARCHAR | The label as it appeared in the VTT (e.g. `Speaker 1`, or a name if the VTT already has one). |
| `display_name` | VARCHAR | User-editable; defaults to `raw_label`. Renaming updates this, not `speaker_id`. |
| `color` | VARCHAR | Optional, for visually distinguishing speakers in the transcript. |

### 5.3 `transcript_segment`
The normalized cue list — one row per VTT cue.

| Column | Type | Notes |
|---|---|---|
| `segment_id` | UUID (PK) | |
| `transcript_id` | UUID (FK) | |
| `speaker_id` | UUID (FK, nullable) | Null if VTT has no speaker tags. |
| `sequence_index` | INTEGER | Order within transcript. |
| `start_ms` | INTEGER | Cue start, milliseconds. |
| `end_ms` | INTEGER | Cue end, milliseconds. |
| `text` | VARCHAR | Cue text. |

### 5.4 `annotation`
The generalized highlight/note table.

| Column | Type | Notes |
|---|---|---|
| `annotation_id` | UUID (PK) | |
| `transcript_id` | UUID (FK) | |
| `kind` | VARCHAR | `'highlight'` for now; leaves room for a future `'note'`-only annotation with no span. |
| `start_segment_id` | UUID (FK) | First segment the highlight touches. |
| `end_segment_id` | UUID (FK) | Last segment the highlight touches (same as start if single-segment). |
| `start_char_offset` | INTEGER | Character offset into start segment's text. Slice 1 always writes `0` (whole-segment highlights, §9.4); column exists so sub-segment precision later needs no migration. |
| `end_char_offset` | INTEGER | Character offset into end segment's text. Slice 1 always writes `0` (§9.4). |
| `start_ms` | INTEGER | Denormalized from segments, for fast time-range queries/export without joins. |
| `end_ms` | INTEGER | Denormalized, ditto. |
| `highlight_text` | VARCHAR | The literal selected text, captured at creation time (denormalized — survives edits/retagging of the underlying segment text, and is what actually gets exported/read, not a live re-derivation). When a highlight spans multiple segments, join segment texts with a newline — preserve cue breaks, since a cross-segment highlight often captures a question in one cue and its answer in the next. |
| `note` | VARCHAR | Freeform note text. |
| `properties` | JSON | Arbitrary key/value bag for anything not worth a column — this is the "annotations can have... other arbitrary properties" requirement. |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

### 5.5 `tag` and `annotation_tag`
Many-to-many, tags are global (project-scoped, not transcript-scoped) on purpose.

```
tag(tag_id UUID PK, name VARCHAR UNIQUE, color VARCHAR)
annotation_tag(annotation_id UUID FK, tag_id UUID FK, PRIMARY KEY (annotation_id, tag_id))
```

### 5.6 CSV export shape

A single flat view (`export_highlights`) joins the above into the export format, roughly:

```
transcript_participant, transcript_interviewer, transcript_topic, transcript_session_datetime,
speaker_display_name, start_ms, end_ms, highlight_text, note, tags (comma-joined), properties (JSON string),
highlight_uri
```

DuckDB's `COPY (SELECT * FROM export_highlights) TO 'highlights.csv' (HEADER, DELIMITER ',')` does this natively — worth building the view once and having export just be that one `COPY` statement.

### 5.7 `meta`

Simple schema versioning — a one-key-per-row table, with `schema_version` stamped at creation:

```
meta(key VARCHAR PRIMARY KEY, value VARCHAR)
```

Slice 1 only writes `schema_version` (e.g. `'1'`). Anything that later needs a data migration checks this value on open; nothing else uses the table today, but its existence means the first real migration has a hook instead of a retrofit.

## 6. Highlight URI Scheme

Requirement: a highlight has a URI that focuses that transcript region. Proposed scheme (app-internal, works for a desktop shell's custom protocol handler or as an in-app route):

```
qda://transcript/{transcript_id}/highlight/{annotation_id}
```

Resolving this: load the transcript (if not already open), scroll the transcript view to `start_segment_id`, apply a focus/flash state to the highlighted span, and optionally cue the video to `start_ms` without auto-playing. This also gives a free "deep link to a moment" feature for free-standing time ranges if ever needed:

```
qda://transcript/{transcript_id}/at/{start_ms}
```

Keep both forms; the highlight form is the one actually required, the time form is a natural, nearly-free extension.

## 7. UI / Interaction Design

### 7.1 Layout

- **Primary pane (majority of width): the transcript.** Continuous scroll, segments grouped visually by speaker turn, speaker labels clearly tagged and colored.
- **Media: collapsed by default.** A slim bar (or floating mini-player) that expands into a player when the user explicitly opens it, or auto-expands (small) when a highlight/segment is clicked to play — but stays out of the way otherwise. Never dominant. If no media file exists for the transcript, or media is toggled off, the bar is absent entirely.
- **Margin tray/drawer:** anchored to one side of the transcript (right margin is the natural Descript-like convention). Shows highlights as they occur down the transcript (position roughly mirrors where they are in the text), each as a compact card: snippet of highlighted text, tags, speaker. Clicking a tray card scrolls the transcript to it and vice versa (selecting a highlight in the transcript highlights its tray card).
- **Highlights-only view:** a toggle that collapses the transcript pane to show *only* highlighted spans, still in transcript order, each still clickable to seek video and still editable (tags/notes) in place. This is a filtered projection of the same transcript view, not a separate screen, to keep it cheap and consistent.

### 7.2 Making a highlight

1. User selects a text span in the transcript (standard text selection, can cross segment boundaries).
2. A small contextual control appears ("Highlight" button, or a keyboard shortcut) — creates the `annotation` row immediately with no tags/note (fast capture, matches how researchers actually work — tag later).
3. The tray gets a new card at the corresponding position; the transcript shows the highlighted span with a background treatment.

### 7.3 Overlapping highlights

Since spans can overlap, the transcript needs a rendering strategy that doesn't just rely on background color (two overlapping highlights can't both be "yellow background" legibly). Recommend:
- Underline/border-based marking rather than pure background fill, so overlaps are visually stackable (e.g. one highlight = underline, a second overlapping one = a second, offset underline or a subtly different hue border).
- Clicking inside an overlapping region where multiple highlights exist shows a small disambiguation popover ("2 highlights here") rather than guessing which one the user meant.

### 7.4 Tagging / notes / properties

- Tag input is a simple multi-select/create-on-type control on the highlight's tray card or in an expanded edit panel.
- Note is a plain text field, same location.
- "Other arbitrary properties" (the `properties` JSON column) — for v1, expose this as a simple key/value list editor in an "advanced" section of the highlight edit panel, not a priority for the main flow. This is mostly there so the schema doesn't need to change when a future requirement shows up.

### 7.5 Speaker renaming

- Clicking a speaker label opens a rename control; updates `speaker.display_name` only. `speaker_id` and all `transcript_segment.speaker_id` references are untouched, so renaming is instant and doesn't rewrite history.

## 8. Non-Functional Requirements

- **Local-first, offline-capable.** No network dependency for core function.
- **Non-destructive.** Original video and VTT files are never modified; all derived state lives in the DuckDB file.
- **Fast on realistic transcript lengths.** A 60–90 minute interview VTT (hundreds of cues) should load and scroll smoothly; avoid re-rendering the entire transcript on every highlight edit (virtualize the segment list).
- **Portable project folders.** Folder portability now means two things in the browser: (a) the OPFS-persisted DuckDB data survives reloads and can be exported/re-imported as a file if the user switches machines; (b) source files are referenced by file *name*, not path — the File System Access API exposes no absolute paths, and handles don't survive a folder move, so the DB must never bake in path assumptions (§5.1 paths are display-friendly names only).
- **Forward-compatible schema.** Every table keyed for eventual multi-transcript use, per §5, so the future project-workspace tool can be additive.

## 9. Open Questions to Resolve Before/During Build

1. **Desktop shell vs. browser app — RESOLVED.** Browser-based, DuckDB-WASM + OPFS + File System Access API (§3.1, §3.4).
2. **Cross-transcript speaker identity:** today `speaker_id` is stable *within* a transcript. When multi-transcript lands, will speakers be matched across transcripts automatically (e.g. same interviewer tagged consistently), manually merged by the user, or kept fully separate per transcript? Doesn't need an answer now, but the `speaker` table's `transcript_id` column means "merge these speaker rows" is the kind of operation that should stay possible.
3. **VTT speaker tagging format — RESOLVED via sample data.** Samples in `sample-data/` are Google Meet exports: plain cue text with a `Speaker Name: ` prefix (real names, so `speaker.raw_label` holds them directly), numbered cues, `HH:MM:SS.mmm --> HH:MM:SS.mmm` timestamps, and **no** `<v>` tags, NOTE, or STYLE blocks (~500 cues per ~60 min session). The parser should still tolerate `<v>` tags and untagged cues defensively (§5.3 allows null speaker), but the primary format is confirmed. The sample set conveniently covers the media cases: one VTT-only file (no-media path) and one folder with both `.mp4` and `.m4a` (video-preferred path).
4. **Sub-segment highlight precision — RESOLVED for slice 1.** Highlights snap to whole segments. The char-offset columns (§5.4) are still created and populated with `0` from day one, so upgrading to sub-segment precision later is a behavior change in the UI layer, not a schema migration.
5. **Tray ordering when highlights overlap:** if two highlights start at the same position, what determines tray order — creation time, or span length? Minor, but worth a decision.

## 10. Suggested Build Phases

### 10.1 Slice 1 — transcript-only (first build)

Deliberately excludes all media handling, but nothing here should preclude adding it: the schema already carries a nullable `source_media_path` (§5.1), and the transcript view must treat "no media attached" as a normal, first-class state — because that's how it ships.

1. **VTT loader:** parse VTT into `transcript`/`transcript_segment`/`speaker` rows; render read-only transcript with speaker labels.
2. **Highlighting core:** text selection → `annotation` row; overlapping-highlight rendering; tray drawer showing highlights in position.
3. **Highlight editing:** tags, notes, properties panel; speaker rename.
4. **Export:** CSV export view + `COPY` statement; sanity-check the flattened shape against a real downstream analysis workflow (e.g. open in a spreadsheet and see if it's actually usable as-is).

### 10.2 Later slices

1. **Going multimedia:** attach an optional paired video/audio file at import (pair media to VTT by matching filename stem, treating `.transcript.vtt`'s extra suffix as strippable; video preferred when both exist). Playback is driven from transcript interactions — clicking a segment or highlight seeks and plays — while the player itself stays secondary: collapsed by default per §7.1, with a toggle to hide media entirely and work transcript-only. Browser file handles don't survive sessions (§8), so a transcript with a stored media name but no in-session file shows an "attach media" affordance instead of silently failing.
2. **Views:** highlights-only view; highlight URI resolution/deep-linking.
3. **Polish/perf pass:** virtualized transcript rendering, tray/transcript sync scrolling, project-folder portability check (move the folder, reopen, confirm nothing breaks).

---

*This is a planning draft for iteration — architecture and schema choices above are recommendations, not commitments. Flag anything in §9 you want to settle differently before this goes to a coding agent.*
