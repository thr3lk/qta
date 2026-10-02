import { For, Show, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import TranscriptView from "./components/TranscriptView";
import Tray from "./components/Tray";
import ImportDialog from "./components/ImportDialog";
import MediaPlayer from "./components/MediaPlayer";
import Library from "./components/Library";
import {
  boot,
  exportCsv,
  mediaFile,
  mediaHidden,
  openTranscript,
  setMediaHidden,
  showView,
  state,
} from "./lib/store";
import { downloadBytes, exportFileName } from "./lib/export";

type PendingHighlight = {
  lo: number;
  hi: number;
  rectTop: number;
  rectLeft: number;
} | null;

export default function App(): JSX.Element {
  const [pending, setPending] = createSignal<PendingHighlight>(null);
  const [importOpen, setImportOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  const [exportStatus, setExportStatus] = createSignal("");

  onMount(() => {
    void boot();
  });

  const doExport = async () => {
    if (!state.activeId || !state.transcript) return;
    setExportStatus("Exporting…");
    try {
      const bytes = await exportCsv();
      downloadBytes(bytes, exportFileName(state.transcript.participantName, state.transcript.createdAt));
      setExportStatus("Exported");
      setTimeout(() => setExportStatus(""), 2500);
    } catch (e) {
      setExportStatus(`Export failed: ${e}`);
    }
  };

  return (
    <div class="app">
      <header class="app-header">
        <h1>QTA Transcript Analyzer</h1>
        <Show when={state.phase === "ready" || state.transcripts.length > 0}>
          <nav class="view-tabs">
            <button
              classList={{ active: state.view === "review" }}
              data-testid="tab-review"
              onClick={() => showView("review")}
            >
              Review
            </button>
            <button
              classList={{ active: state.view === "library" }}
              data-testid="tab-library"
              onClick={() => showView("library")}
            >
              Library
            </button>
          </nav>
        </Show>
        <Show when={state.phase === "ready"}>
          <select
            data-testid="transcript-select"
            value={state.activeId ?? ""}
            onChange={(e) => void openTranscript(e.currentTarget.value)}
          >
            <For each={state.transcripts}>
              {(t) => (
                <option value={t.transcriptId}>
                  {t.participantName ? `${t.participantName} — ` : ""}
                  {t.sourceVttPath}
                </option>
              )}
            </For>
          </select>
          <button data-testid="export-button" onClick={() => void doExport()}>
            Export CSV
          </button>
          <span class="status-line" data-testid="export-status">
            {exportStatus()}
          </span>
          <Show when={mediaFile() !== null}>
            <button
              data-testid="media-toggle"
              onClick={() => setMediaHidden(!mediaHidden())}
            >
              {mediaHidden() ? "Show media" : "Hide media"}
            </button>
          </Show>
        </Show>
        <button data-testid="import-button" onClick={() => setImportOpen(true)}>
          Import…
        </button>
      </header>
      <Show
        when={state.phase !== "loading"}
        fallback={<div class="loading">Loading database…</div>}
      >
        <Show when={state.phase === "ready" && state.view === "review"}>
          <main class="app-main">
            <div class="transcript-column">
              <MediaPlayer />
              <TranscriptView pendingHighlight={pending()} setPendingHighlight={setPending} />
            </div>
            <Tray filter={filter()} setFilter={setFilter} />
          </main>
        </Show>
        <Show when={state.phase === "welcome"}>
          <div class="welcome">
            <h2>No transcripts yet</h2>
            <p>
              Point QTA at a folder containing .vtt transcripts. Highlights,
              tags, and notes are stored locally in your browser.
            </p>
            <button class="primary" data-testid="welcome-import" onClick={() => setImportOpen(true)}>
              Import a transcript…
            </button>
          </div>
        </Show>
        <Show when={state.view === "library" && state.phase !== "welcome"}>
          <Library />
        </Show>
      </Show>
      <ImportDialog open={importOpen()} onClose={() => setImportOpen(false)} />
    </div>
  );
}
