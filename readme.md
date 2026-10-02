# Cute Transcript Analyzer
A cute tool for QDA

start with a folder of VTT transcripts, and optionally, associated video files
load up QTA
see a lightweight transcript annotation tool
make highlights on the transcript, add tags and notes
get a csv of highlights, tags, notes


# running the app

the app lives in `app/` and runs entirely in the browser (no install, no server)
requires Node 20+; use a Chromium-based browser (Chrome/Edge) for folder access

```sh
cd app
npm install
npm run dev      # then open http://localhost:5200
```

first run: click "Import a transcript…", pick the folder (or files) containing
your `.vtt` transcripts (see `sample-data/` for examples), and import one.
select text in the transcript to highlight, tag, and annotate; "Export CSV"
downloads the highlights.

your work is stored locally in the browser (OPFS-backed DuckDB, one file per
origin) and survives restarts. notes:

- only one tab should have the app open at a time (single DB handle)
- re-importing a VTT creates a new copy in the database; the old one stays
- no video/audio in this slice yet — transcript only

# development

```sh
cd app
npm run test     # vitest unit tests (VTT parser)
npm run build    # production build to app/dist
npm run e2e      # build must exist first; playwright smoke test
                 # (imports sample data, highlights, restarts browser, exports)
```

# future plans
project management
