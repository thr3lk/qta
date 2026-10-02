import { For, Show, createSignal } from "solid-js";
import { importVttFile, state } from "../lib/store";

interface ListedFile {
  name: string;
  file: File | null;
  imported: boolean;
}

export default function ImportDialog(props: { open: boolean; onClose: () => void }) {
  const [files, setFiles] = createSignal<ListedFile[]>([]);
  const [error, setError] = createSignal("");

  const importedNames = () => new Set(state.transcripts.map((t) => t.sourceVttPath));

  const collectFromInput = async (fileList: FileList | null) => {
    if (!fileList) return;
    const list: ListedFile[] = [];
    for (const f of Array.from(fileList)) {
      if (!f.name.toLowerCase().endsWith(".vtt")) continue;
      list.push({ name: f.name, file: f, imported: importedNames().has(f.name) });
    }
    setFiles(list);
    if (list.length === 0) setError("No .vtt files found in that folder.");
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
      const list: ListedFile[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind !== "file") continue;
        if (!entry.name.toLowerCase().endsWith(".vtt")) continue;
        const file = await entry.getFile();
        list.push({ name: entry.name, file, imported: importedNames().has(entry.name) });
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      setFiles(list);
      if (list.length === 0) setError("No .vtt files found in that folder.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError("Folder access unavailable; use the file picker below.");
      }
    }
  };

  const doImport = async (entry: ListedFile) => {
    if (!entry.file) return;
    try {
      await importVttFile(entry.file);
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
            Pick a folder of recordings or choose .vtt files. Importing reads the
            VTT into the local database; the original file is never modified.
          </p>
          <div class="row" style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => void openFolder()}>Open folder…</button>
            <label class="primary" style={{ "border-radius": "6px", padding: "5px 12px", background: "var(--accent)", color: "#fff", cursor: "pointer", border: "1px solid var(--accent)", "font-size": "inherit" }}>
              Choose files…
              <input
                type="file"
                multiple
                accept=".vtt,text/vtt"
                class="visually-hidden"
                data-testid="vtt-file-input"
                onChange={(e) => void collectFromInput(e.currentTarget.files)}
              />
            </label>
          </div>
          <Show when={error()}>
            <div class="status-line danger">{error()}</div>
          </Show>
          <For each={files()}>
            {(entry) => (
              <div class="file-row" data-testid="vtt-file-row">
                <span class="fname">{entry.name}</span>
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
