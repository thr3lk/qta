import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { AnnotationRow } from "../lib/types";
import {
  addTagTo,
  deleteAnnotation,
  removeTagFrom,
  saveNote,
  saveProperties,
  seekMedia,
  selectAnnotation,
  speakerDisplayName,
  state,
} from "../lib/store";
import { annotationColor } from "../lib/colors";
import { formatMs, snippet } from "../lib/format";

function EditPanel(props: { annotation: AnnotationRow }) {
  const [note, setNote] = createSignal(props.annotation.note ?? "");
  const [props_, setProps_] = createSignal(
    Object.entries(props.annotation.properties ?? {}).map(([k, v]) => ({
      key: k,
      value: String(v ?? ""),
    })),
  );
  const [tagDraft, setTagDraft] = createSignal("");

  createEffect(() => {
    props.annotation.annotationId;
    setNote(props.annotation.note ?? "");
    setProps_(
      Object.entries(props.annotation.properties ?? {}).map(([k, v]) => ({
        key: k,
        value: String(v ?? ""),
      })),
    );
    setTagDraft("");
  });

  let noteTimer: number | undefined;
  const onNoteInput = (value: string) => {
    setNote(value);
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      void saveNote(props.annotation.annotationId, value);
    }, 500);
  };

  const appliedTagNames = () => new Set(props.annotation.tags.map((t) => t.name));
  const suggestions = createMemo(() =>
    state.tags.filter((t) => !appliedTagNames().has(t.name)),
  );

  const commitTag = () => {
    const name = tagDraft().trim().replace(/,+$/, "");
    setTagDraft("");
    if (name) void addTagTo(props.annotation.annotationId, name);
  };

  const applyProperties = () => {
    const cleaned: Record<string, unknown> = {};
    for (const row of props_()) {
      const key = row.key.trim();
      if (key === "") continue;
      const num = Number(row.value);
      cleaned[key] = row.value !== "" && !Number.isNaN(num) ? num : row.value;
    }
    void saveProperties(props.annotation.annotationId, Object.keys(cleaned).length ? cleaned : null);
  };

  return (
    <div class="editor" data-testid="edit-panel">
      <div class="row">
        <input
          data-testid="tag-input"
          placeholder="Add tag…"
          value={tagDraft()}
          onInput={(e) => setTagDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitTag();
            }
          }}
          list="tag-suggestions"
        />
        <datalist id="tag-suggestions">
          <For each={suggestions()}>{(t) => <option value={t.name} />}</For>
        </datalist>
      </div>
      <Show when={props.annotation.tags.length > 0}>
        <div class="card-tags">
          <For each={props.annotation.tags}>
            {(tag) => (
              <span class="chip">
                {tag.name}
                <button
                  title={`Remove tag ${tag.name}`}
                  onClick={() => void removeTagFrom(props.annotation.annotationId, tag.tagId)}
                >
                  ×
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>
      <textarea
        data-testid="note-input"
        placeholder="Note…"
        value={note()}
        onInput={(e) => onNoteInput(e.currentTarget.value)}
      />
      <div class="status-line">Properties</div>
      <For each={props_()}>
        {(row, i) => (
          <div class="props-row">
            <input
              placeholder="key"
              value={row.key}
              onInput={(e) =>
                setProps_((rows) =>
                  rows.map((r, j) => (j === i() ? { ...r, key: e.currentTarget.value } : r)),
                )
              }
            />
            <input
              placeholder="value"
              value={row.value}
              onInput={(e) =>
                setProps_((rows) =>
                  rows.map((r, j) => (j === i() ? { ...r, value: e.currentTarget.value } : r)),
                )
              }
            />
            <button
              title="Remove property"
              onClick={() => setProps_((rows) => rows.filter((_, j) => j !== i()))}
            >
              ×
            </button>
          </div>
        )}
      </For>
      <div class="row">
        <button
          onClick={() =>
            setProps_((rows) => [...rows, { key: "", value: "" }])
          }
        >
          Add property
        </button>
        <button data-testid="apply-properties" onClick={applyProperties}>
          Apply
        </button>
      </div>
      <div class="editor-actions">
        <span class="meta">
          created {props.annotation.createdAt.slice(0, 16).replace("T", " ")}
        </span>
        <button
          class="danger"
          data-testid="delete-highlight"
          onClick={() => {
            if (window.confirm("Delete this highlight?")) {
              void deleteAnnotation(props.annotation.annotationId);
            }
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function Tray(props: { filter: string; setFilter: (f: string) => void }) {
  const ordered = createMemo(() =>
    [...state.annotations].sort(
      (a, b) => a.startMs - b.startMs || a.createdAt.localeCompare(b.createdAt),
    ),
  );

  const filtered = createMemo(() => {
    const f = props.filter.trim().toLowerCase();
    if (!f) return ordered();
    return ordered().filter(
      (a) =>
        a.highlightText.toLowerCase().includes(f) ||
        (a.note ?? "").toLowerCase().includes(f) ||
        a.tags.some((t) => t.name.toLowerCase().includes(f)),
    );
  });

  createEffect(() => {
    const id = state.selectedAnnotationId;
    if (!id) return;
    const el = document.querySelector(`[data-card-id="${id}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  return (
    <aside class="tray" data-testid="tray">
      <div class="tray-header">
        <span>Highlights</span>
        <span class="tray-count">{state.annotations.length}</span>
      </div>
      <input
        class="filter"
        data-testid="tray-filter"
        placeholder="Filter by text, note, or tag…"
        value={props.filter}
        onInput={(e) => props.setFilter(e.currentTarget.value)}
      />
      <Show
        when={filtered().length > 0}
        fallback={<div class="tray-empty">No highlights yet. Select text in the transcript and press Highlight.</div>}
      >
        <For each={filtered()}>
          {(ann) => (
            <div
              class="card"
              classList={{ selected: state.selectedAnnotationId === ann.annotationId }}
              data-card-id={ann.annotationId}
              data-testid="tray-card"
              onClick={() => {
                selectAnnotation(ann.annotationId);
                seekMedia(ann.startMs);
              }}
            >
              <div class="card-top">
                <span>
                  {formatMs(ann.startMs)}–{formatMs(ann.endMs)}
                </span>
                <span>{speakerDisplayNameOf(ann)}</span>
              </div>
              <div class="card-body">
                <span
                  class="card-swatch"
                  style={{ background: annotationColor(ann.annotationId) }}
                />
                <div>
                  <div class="card-snippet">{snippet(ann.highlightText)}</div>
                  <Show when={ann.note}>
                    <div class="badge">note</div>
                  </Show>
                  <Show when={ann.tags.length > 0}>
                    <div class="card-tags">
                      <For each={ann.tags}>
                        {(tag) => <span class="chip plain">{tag.name}</span>}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
              <Show when={state.selectedAnnotationId === ann.annotationId}>
                <EditPanel annotation={ann} />
              </Show>
            </div>
          )}
        </For>
      </Show>
    </aside>
  );
}

function speakerDisplayNameOf(ann: AnnotationRow): string {
  const idx = segmentIndexLookup(ann);
  return speakerDisplayName(idx);
}

function segmentIndexLookup(ann: AnnotationRow): string | null {
  const seg = state.segments.find((s) => s.segmentId === ann.startSegmentId);
  return seg?.speakerId ?? null;
}
