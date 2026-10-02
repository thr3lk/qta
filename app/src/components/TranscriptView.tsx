import { For, Show, createMemo, createSignal } from "solid-js";
import type { AnnotationRow, SegmentRow, SpeakerRow } from "../lib/types";
import {
  annotationsCovering,
  closeChooser,
  createHighlight,
  goToAnnotation,
  goToSegment,
  openChooser,
  renameSpeaker,
  selectAnnotation,
  segmentIndexById,
  speakerDisplayName,
  state,
} from "../lib/store";
import { annotationColor } from "../lib/colors";

interface Turn {
  speaker: SpeakerRow | null;
  segments: SegmentRow[];
}

const turns = createMemo<Turn[]>(() => {
  const result: Turn[] = [];
  for (const seg of state.segments) {
    const last = result[result.length - 1];
    if (last && last.speaker?.speakerId === seg.speakerId) {
      last.segments.push(seg);
    } else {
      result.push({
        speaker: state.speakers.find((s) => s.speakerId === seg.speakerId) ?? null,
        segments: [seg],
      });
    }
  }
  return result;
});

function HighlightLayers(props: {
  annotations: AnnotationRow[];
  text: string;
  segmentId: string;
}) {
  return (
    <Show
      when={props.annotations.length > 0}
      fallback={<span>{props.text}</span>}
    >
      <Layer anns={props.annotations} depth={0} text={props.text} segmentId={props.segmentId} />
    </Show>
  );
}

function Layer(props: {
  anns: AnnotationRow[];
  depth: number;
  text: string;
  segmentId: string;
}) {
  const ann = () => props.anns[0];
  return (
    <span
      class="hl"
      data-hl-id={ann().annotationId}
      style={{
        "text-decoration": "underline",
        "text-decoration-color": annotationColor(ann().annotationId),
        "text-decoration-thickness": "2px",
        "text-underline-offset": `${2 + props.depth * 4}px`,
      }}
    >
      <Show when={props.anns.length > 1} fallback={props.text}>
        <Layer anns={props.anns.slice(1)} depth={props.depth + 1} text={props.text} segmentId={props.segmentId} />
      </Show>
    </span>
  );
}

function SpeakerLabel(props: { speaker: SpeakerRow | null }) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  const commit = () => {
    setEditing(false);
    if (props.speaker && draft() !== (props.speaker.displayName ?? props.speaker.rawLabel ?? "")) {
      void renameSpeaker(props.speaker.speakerId, draft());
    }
  };

  return (
    <div class="speaker-label">
      <span
        class="speaker-dot"
        style={{ background: props.speaker?.color ?? "#9ca3af" }}
      />
      <Show
        when={editing() && props.speaker}
        fallback={
          <button
            data-testid={`speaker-${props.speaker?.speakerId ?? "unknown"}`}
            title="Click to rename"
            onClick={() => {
              setDraft(props.speaker?.displayName ?? props.speaker?.rawLabel ?? "");
              setEditing(true);
            }}
          >
            {speakerDisplayName(props.speaker?.speakerId ?? null)}
          </button>
        }
      >
        <input
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={commit}
        />
      </Show>
    </div>
  );
}

export default function TranscriptView(props: {
  pendingHighlight: { lo: number; hi: number; rectTop: number; rectLeft: number } | null;
  setPendingHighlight: (p: { lo: number; hi: number; rectTop: number; rectLeft: number } | null) => void;
}) {
  const idxMap = () => segmentIndexById();

  const segmentEl = (node: Node | null): HTMLElement | null => {
    const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
    return el?.closest<HTMLElement>("[data-segment-id]") ?? null;
  };

  const updatePending = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      props.setPendingHighlight(null);
      return false;
    }
    const range = sel.getRangeAt(0);
    const startEl = segmentEl(range.startContainer);
    const endEl = segmentEl(range.endContainer);
    if (!startEl || !endEl) {
      props.setPendingHighlight(null);
      return false;
    }
    const startIdx = idxMap().get(startEl.dataset.segmentId!) ?? -1;
    const endIdx = idxMap().get(endEl.dataset.segmentId!) ?? -1;
    if (startIdx === -1 || endIdx === -1) {
      props.setPendingHighlight(null);
      return false;
    }
    const rect = range.getBoundingClientRect();
    props.setPendingHighlight({
      lo: Math.min(startIdx, endIdx),
      hi: Math.max(startIdx, endIdx),
      rectTop: rect.top,
      rectLeft: rect.left + rect.width / 2,
    });
    return true;
  };

  const onMouseUp = (e: MouseEvent) => {
    setTimeout(() => {
      const hasRange = updatePending();
      if (hasRange) return;
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-segment-id]");
      if (!target) {
        closeChooser();
        return;
      }
      const segIdx = idxMap().get(target.dataset.segmentId!) ?? -1;
      const clickedSeg = state.segments[segIdx];
      const covering = annotationsCovering(target.dataset.segmentId!);
      if (covering.length === 1) {
        selectAnnotation(covering[0].annotationId);
        goToAnnotation(covering[0]);
      } else {
        if (clickedSeg) goToSegment(clickedSeg);
        if (covering.length > 1) {
          openChooser(target.dataset.segmentId!, e.clientX, e.clientY);
        } else {
          closeChooser();
        }
      }
    }, 0);
  };

  const createFromPending = () => {
    const pending = props.pendingHighlight;
    if (!pending) return;
    void createHighlight(pending.lo, pending.hi);
    window.getSelection()?.removeAllRanges();
    props.setPendingHighlight(null);
  };

  document.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "h" && props.pendingHighlight) {
      e.preventDefault();
      createFromPending();
    }
  });

  document.addEventListener("selectionchange", () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) props.setPendingHighlight(null);
    }, 0);
  });

  return (
    <div class="transcript-pane" data-testid="transcript-pane" onMouseUp={onMouseUp}>
      <For each={turns()}>
        {(turn) => (
          <div class="turn">
            <SpeakerLabel speaker={turn.speaker} />
            <For each={turn.segments}>
              {(seg) => {
                const covering = () => annotationsCovering(seg.segmentId);
                return (
                  <p
                    class="seg"
                    classList={{ flash: state.flashSegmentIds.includes(seg.segmentId) }}
                    data-segment-id={seg.segmentId}
                    data-testid="segment"
                  >
                    <HighlightLayers
                      annotations={covering()}
                      text={seg.text}
                      segmentId={seg.segmentId}
                    />
                  </p>
                );
              }}
            </For>
          </div>
        )}
      </For>
      <Show when={props.pendingHighlight}>
        {(pending) => (
          <button
            class="hl-menu-btn"
            data-testid="highlight-button"
            style={{
              top: `${Math.max(8, pending().rectTop - 42)}px`,
              left: `${Math.min(window.innerWidth - 110, Math.max(8, pending().rectLeft - 44))}px`,
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={createFromPending}
          >
            Highlight
          </button>
        )}
      </Show>
      <Show when={state.chooser}>
        {(chooser) => (
          <div
            class="chooser"
            style={{ top: `${chooser().y + 6}px`, left: `${chooser().x}px` }}
          >
            <div class="chooser-title">
              {annotationsCovering(chooser().segmentId).length} highlights here
            </div>
            <For each={annotationsCovering(chooser().segmentId)}>
              {(ann) => (
                <button
                  onClick={() => {
                    selectAnnotation(ann.annotationId);
                    goToAnnotation(ann);
                    closeChooser();
                  }}
                >
                  <span
                    class="speaker-dot"
                    style={{ background: annotationColor(ann.annotationId) }}
                  />{" "}
                  {firstLine(ann.highlightText)}
                </button>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
}

function firstLine(text: string): string {
  return text.split("\n")[0].slice(0, 60);
}
