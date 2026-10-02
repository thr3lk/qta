import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { importVttFile, state } from "../lib/store";
import { baseStem, isMediaFile, isVideoFile } from "../lib/media";

interface ListedFile {
  name: string;
  file: File | null;
  media: File | null;
  mediaConflict: boolean;
}

const importedNames = () => new Set(state.transcripts.map((t) => t.sourceVttPath));

function pairMedia(vttName: string, mediaFiles: File[]): {
  media: File | null;
  conflict: boolean;
} {
  const stem = baseStem(vttName);
  const matches = mediaFiles.filter((m) => baseStem(m.name) === stem);
  if (matches.length === 0) return { media: null, conflict: false };
  const video = matches.find((m) => isVideoFile(m.name));
  return { media: video ?? matches[0], conflict: matches.length > 1 };
}

export default function ImportDialog(props: { open: boolean; onClose: () => void }): JSX.Element {
  const [files, setFiles] = createSignal<ListedFile[]>([]);
  const [error, setError] = createSignal("");

  const collectFiles = async (fileList: Iterable<File>) => {
    const all = Array.from(fileList);
    const vtts = all.filter((f) => f.name.toLowerCase().endsWith(".vtt"));
    const media = all.filter((f) => isMediaFile(f.name));
    const list: ListedFile[] = vtts.map((f) => {
      const { media: paired, conflict } = pairMedia(f.name, media);
      return {
        name: f.name,
        file: f,
        media: paired,
        mediaConflict: conflict,
      };
    });
    setFiles(list);
    if (list.length === 0) setError("No .vtt files found.");
  };

  const openFolder = async () => {
    setError("");
    try {
      const picker = (
        window as unknown as {
          showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker;
      if (!picker) throw new Error("no folder picker");
      const dir = await picker();
      const collected: File[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind !== "file") continue;
        collected.push(await entry.getFile());
      }
      collected.sort((a, b) => a.name.localeCompare(b.name));
      await collectFiles(collected);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError("Folder access unavailable; use the file picker below.");
      }
    }
  };

  const doImport = async (entry: ListedFile) => {
    if (!entry.file) return;
    try {
      await importVttFile(entry.file, entry.media);
      props.onClose();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Show when={props.open}>
      <div class="modal-overlay" onClick={props.onClose}>
        <div class="modal" onClick={(e) => e.stopPropagation()} data-testid="import-dialog">
          <h2>Import a transcript</h2>
          <p class="status-line">
            Pick a folder of recordings or choose files. A video or audio file
            whose name matches the transcript is attached automatically (video
            wins if both exist). The original files are never modified.
          </p>
          <div class="row" style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => void openFolder()}>Open folder…</button>
            <label class="primary attach-label">
              Choose files…
              <input
                type="file"
                multiple
                accept=".vtt,video/*,audio/*"
                class="visually-hidden"
                data-testid="vtt-file-input"
                onChange={(e) => void collectFiles(e.currentTarget.files ?? [])}
              />
            </label>
          </div>
          <Show when={error()}>
            <div class="status-line danger">{error()}</div>
          </Show>
          <For each={files()}>
            {(entry) => (
              <div class="file-row" data-testid="vtt-file-row">
                <span class="fname">
                  {entry.name}
                  <Show when={entry.media}>
                    <span class="badge">
                      {" "}
                      + {entry.media!.name}
                      <Show when={entry.mediaConflict}> (video preferred)</Show>
                    </span>
                  </Show>
                </span>
                <div class="actions">
                  <Show when={importedNames().has(entry.name)}>
                    <span class="badge">imported</span>
                  </Show>
                  <Show
                    when={importedNames().has(entry.name)}
                    fallback={
                      <button class="primary" onClick={() => void doImport(entry)}>
                        Import
                      </button>
                    }
                  >
                    <button onClick={props.onClose}>Open existing</button>
                    <button data-testid="reimport" onClick={() => void doImport(entry)}>
                      Re-import
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <div class="row" style={{ "justify-content": "flex-end" }}>
            <button onClick={props.onClose}>Close</button>
          </div>
        </div>
      </div>
    </Show>
  );
}
