import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { deleteTranscript, openTranscript, state } from "../lib/store";
import { formatMs } from "../lib/format";

export default function Library(): JSX.Element {
  return (
    <div class="library" data-testid="library">
      <div class="library-head">
        <h2>Library</h2>
        <span class="status-line">
          {state.transcripts.length} recording{state.transcripts.length === 1 ? "" : "s"}
        </span>
      </div>
      <Show
        when={state.transcripts.length > 0}
        fallback={
          <div class="tray-empty">
            Nothing imported yet. Use "Import…" to add transcripts.
          </div>
        }
      >
        <For each={state.transcripts}>
          {(t) => {
            const stats = () => state.stats.get(t.transcriptId);
            return (
              <div class="library-row" data-testid="library-row">
                <div class="library-main">
                  <div class="library-title">
                    {t.participantName ? `${t.participantName} — ` : ""}
                    {t.sourceVttPath}
                  </div>
                  <div class="library-meta">
                    <Show when={t.sessionDatetime}>
                      <span>{t.sessionDatetime?.slice(0, 16)}</span>
                    </Show>
                    <Show when={t.durationSeconds}>
                      <span>{formatMs((t.durationSeconds ?? 0) * 1000)}</span>
                    </Show>
                    <Show when={t.sourceMediaPath}>
                      <span>media: {t.sourceMediaPath}</span>
                    </Show>
                    <span>imported {t.createdAt.slice(0, 10)}</span>
                  </div>
                </div>
                <div class="library-counts" data-testid="library-counts">
                  <span title="highlights">{stats()?.highlights ?? 0} highlights</span>
                  <span title="notes">{stats()?.notes ?? 0} notes</span>
                </div>
                <div class="actions">
                  <button
                    data-testid="library-open"
                    onClick={() => {
                      void openTranscript(t.transcriptId);
                    }}
                  >
                    Open
                  </button>
                  <button
                    class="danger"
                    data-testid="library-delete"
                    onClick={() =>
                      void deleteTranscript(t.transcriptId).catch((e) =>
                        console.error("DELETE_ERR", String(e)),
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
