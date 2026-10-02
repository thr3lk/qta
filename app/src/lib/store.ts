import { createContext, useContext } from "solid-js";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type {
  AnnotationRow,
  SegmentRow,
  SpeakerRow,
  TagRow,
  TranscriptRow,
} from "./types";
import { getWorkspace, type Workspace } from "./db";
import {
  deleteMediaFile,
  loadMediaFile,
  pruneMediaFiles,
  saveMediaFile,
} from "./mediaStore";
import { guessParticipantName, guessSessionDatetime, parseVtt } from "./vtt";
import { highlightText, resolveSpan } from "./highlight";

export interface AppState {
  phase: "loading" | "welcome" | "ready";
  view: "review" | "library";
  stats: Map<string, { highlights: number; notes: number }>;
  transcripts: TranscriptRow[];
  activeId: string | null;
  transcript: TranscriptRow | null;
  segments: SegmentRow[];
  speakers: SpeakerRow[];
  annotations: AnnotationRow[];
  tags: TagRow[];
  selectedAnnotationId: string | null;
  flashSegmentIds: string[];
  chooser: { segmentId: string; x: number; y: number } | null;
  importing: boolean;
}

export const [mediaFile, setMediaFile] = createSignal<File | null>(null);
export const [mediaHidden, setMediaHidden] = createSignal(false);

export type PlaybackMode = "play-from" | "go-to" | "play-only";

const PLAYBACK_MODE_KEY = "qta.playbackMode";

function loadPlaybackMode(): PlaybackMode {
  try {
    const v = localStorage.getItem(PLAYBACK_MODE_KEY);
    if (v === "go-to" || v === "play-only") return v;
  } catch {
    // storage unavailable; fall through to default
  }
  return "play-from";
}

export const [playbackMode, setPlaybackModeValue] = createSignal<PlaybackMode>(
  loadPlaybackMode(),
);

export function setPlaybackMode(mode: PlaybackMode): void {
  setPlaybackModeValue(mode);
  try {
    localStorage.setItem(PLAYBACK_MODE_KEY, mode);
  } catch {
    // preference just won't persist
  }
}

export interface SeekOptions {
  play: boolean;
  stopAtMs: number | null;
}

let mediaController: {
  seek: (ms: number, opts?: Partial<SeekOptions>) => void;
} | null = null;

export function registerMediaController(controller: {
  seek: (ms: number, opts?: Partial<SeekOptions>) => void;
} | null): void {
  mediaController = controller;
}

export function playRange(startMs: number, endMs: number | null): void {
  if (!mediaFile() || mediaHidden()) return;
  const mode = playbackMode();
  mediaController?.seek(startMs, {
    play: mode !== "go-to",
    stopAtMs: mode === "play-only" ? endMs : null,
  });
}

export function goToAnnotation(ann: AnnotationRow): void {
  playRange(ann.startMs, ann.endMs);
}

export function goToSegment(seg: SegmentRow): void {
  playRange(seg.startMs, seg.endMs);
}

export const [state, setState] = createStore<AppState>({
  phase: "loading",
  view: "review",
  stats: new Map(),
  transcripts: [],
  activeId: null,
  transcript: null,
  segments: [],
  speakers: [],
  annotations: [],
  tags: [],
  selectedAnnotationId: null,
  flashSegmentIds: [],
  chooser: null,
  importing: false,
});

let ws: Workspace | null = null;

function workspace(): Workspace {
  if (!ws) throw new Error("workspace not initialized");
  return ws;
}

export async function boot(): Promise<void> {
  ws = await getWorkspace();
  await refreshTranscripts();
  void pruneMediaFiles(new Set(state.transcripts.map((t) => t.transcriptId))).catch(
    () => {},
  );
  const latest = state.transcripts[0];
  if (latest) {
    await openTranscript(latest.transcriptId);
  } else {
    setState("phase", "welcome");
  }
}

export async function refreshTranscripts(): Promise<void> {
  setState("transcripts", await workspace().listTranscripts());
}

export function showView(view: "review" | "library"): void {
  setState("view", view);
  if (view === "library") void refreshLibrary();
}

export async function refreshLibrary(): Promise<void> {
  await refreshTranscripts();
  setState("stats", await workspace().transcriptStats());
}

export async function deleteTranscript(transcriptId: string): Promise<void> {
  const label =
    state.transcripts.find((t) => t.transcriptId === transcriptId)?.sourceVttPath ??
    transcriptId;
  const stats = state.stats.get(transcriptId);
  const count = stats ? stats.highlights : 0;
  if (
    !window.confirm(
      `Delete recording "${label}" and its ${count} highlight${count === 1 ? "" : "s"}? This cannot be undone.`,
    )
  ) {
    return;
  }
  await workspace().deleteTranscript(transcriptId);
  void deleteMediaFile(transcriptId).catch(() => {});
  await refreshLibrary();
  if (state.activeId === transcriptId) {
    const next = state.transcripts[0];
    if (next) {
      await openTranscript(next.transcriptId);
      setState("view", "review");
    } else {
      setState({ activeId: null, transcript: null, phase: "welcome", view: "library" });
    }
  }
}

export async function openTranscript(transcriptId: string): Promise<void> {
  const w = workspace();
  const transcript = await w.loadTranscript(transcriptId);
  if (!transcript) return;
  const [speakers, segments, annotations] = await Promise.all([
    w.loadSpeakers(transcriptId),
    w.loadSegments(transcriptId),
    w.loadAnnotations(transcriptId),
  ]);
  setState({
    phase: "ready",
    activeId: transcriptId,
    transcript,
    speakers,
    segments,
    annotations,
    tags: await w.loadTags(),
    selectedAnnotationId: null,
    flashSegmentIds: [],
    chooser: null,
  });
  setMediaFile(null);
  setMediaHidden(false);
  const stored = await loadMediaFile(transcriptId).catch(() => null);
  setMediaFile(stored);
}

export async function attachMedia(file: File): Promise<void> {
  if (!state.activeId) return;
  await workspace().setMediaPath(state.activeId, file.name);
  await saveMediaFile(state.activeId, file).catch(() => {});
  setState("transcript", "sourceMediaPath", file.name);
  setMediaFile(file);
  setMediaHidden(false);
}

export async function importVttFile(file: File, mediaFile?: File | null): Promise<void> {
  const w = workspace();
  setState("importing", true);
  try {
    const text = await file.text();
    const cues = parseVtt(text);
    if (cues.length === 0) {
      throw new Error(`No cues found in ${file.name}`);
    }
    const transcriptId = await w.importTranscript(
      file.name,
      cues,
      {
        participantName: guessParticipantName(file.name),
        sessionDatetime: guessSessionDatetime(file.name),
      },
      mediaFile?.name ?? null,
    );
    await refreshTranscripts();
    await openTranscript(transcriptId);
    if (mediaFile) {
      await saveMediaFile(transcriptId, mediaFile).catch(() => {});
      setMediaFile(mediaFile);
    }
  } finally {
    setState("importing", false);
  }
}

export async function reloadAnnotations(): Promise<void> {
  if (!state.activeId) return;
  const annotations = await workspace().loadAnnotations(state.activeId);
  setState("annotations", annotations);
}

function clearFlashSoon(): void {
  setTimeout(() => setState("flashSegmentIds", []), 1800);
}

export async function createHighlight(
  startIdx: number,
  endIdx: number,
  startChar: number,
  endChar: number,
): Promise<void> {
  const span = resolveSpan(startIdx, endIdx, startChar, endChar, state.segments);
  const startSeg = state.segments[span.lo];
  const endSeg = state.segments[span.hi];
  if (!startSeg || !endSeg || !state.activeId) return;
  const newId = await workspace().createAnnotation({
    transcriptId: state.activeId,
    startSegmentId: startSeg.segmentId,
    endSegmentId: endSeg.segmentId,
    startCharOffset: span.startChar,
    endCharOffset: span.endChar,
    startMs: startSeg.startMs,
    endMs: endSeg.endMs,
    highlightText: highlightText(state.segments, span),
  });
  await reloadAnnotations();
  selectAnnotation(newId);
}

export function selectAnnotation(annotationId: string): void {
  setState("selectedAnnotationId", annotationId);
  const ann = state.annotations.find((a) => a.annotationId === annotationId);
  if (!ann) return;
  const idxById = segmentIndexById();
  const lo = idxById.get(ann.startSegmentId) ?? 0;
  const hi = idxById.get(ann.endSegmentId) ?? lo;
  const ids = state.segments.slice(lo, hi + 1).map((s) => s.segmentId);
  setState("flashSegmentIds", ids);
  clearFlashSoon();
  const el = document.querySelector(`[data-segment-id="${ann.startSegmentId}"]`);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
}

const segmentIndexMemo = (() => {
  let cache: { id: string; map: Map<string, number> } | null = null;
  return () => {
    if (!cache || cache.id !== state.activeId) {
      cache = {
        id: state.activeId ?? "",
        map: new Map(state.segments.map((s, i) => [s.segmentId, i])),
      };
    }
    return cache.map;
  };
})();

export function segmentIndexById(): Map<string, number> {
  return segmentIndexMemo();
}

export function annotationsCovering(segmentId: string): AnnotationRow[] {
  const idx = segmentIndexById();
  const segIdx = idx.get(segmentId);
  if (segIdx === undefined) return [];
  return state.annotations.filter((a) => {
    const lo = idx.get(a.startSegmentId);
    const hi = idx.get(a.endSegmentId);
    return lo !== undefined && hi !== undefined && lo <= segIdx && segIdx <= hi;
  });
}

export async function deleteAnnotation(annotationId: string): Promise<void> {
  await workspace().deleteAnnotation(annotationId);
  setState(
    "annotations",
    state.annotations.filter((a) => a.annotationId !== annotationId),
  );
  if (state.selectedAnnotationId === annotationId) {
    setState("selectedAnnotationId", null);
  }
}

export async function saveNote(annotationId: string, note: string): Promise<void> {
  await workspace().updateAnnotationNote(annotationId, note);
  setState(
    "annotations",
    (a) => a.annotationId === annotationId,
    produce((a) => {
      a.note = note.trim() === "" ? null : note;
      a.updatedAt = new Date().toISOString();
    }),
  );
}

export async function saveProperties(
  annotationId: string,
  properties: Record<string, unknown> | null,
): Promise<void> {
  await workspace().updateAnnotationProperties(annotationId, properties);
  await reloadAnnotations();
}

export async function addTagTo(annotationId: string, tagName: string): Promise<void> {
  const w = workspace();
  const tag = await w.addTag(tagName, annotationId);
  await reloadAnnotations();
  const tags = await w.loadTags();
  setState("tags", tags);
  void tag;
}

export async function removeTagFrom(annotationId: string, tagId: string): Promise<void> {
  await workspace().removeTag(annotationId, tagId);
  await reloadAnnotations();
}

export async function renameSpeaker(speakerId: string, displayName: string): Promise<void> {
  await workspace().renameSpeaker(speakerId, displayName);
  setState(
    "speakers",
    (s) => s.speakerId === speakerId,
    produce((s) => {
      s.displayName = displayName.trim() === "" ? null : displayName.trim();
    }),
  );
}

export function openChooser(segmentId: string, x: number, y: number): void {
  setState("chooser", { segmentId, x, y });
}

export function closeChooser(): void {
  setState("chooser", null);
}

export async function exportCsv(): Promise<Uint8Array> {
  if (!state.activeId) throw new Error("no transcript open");
  return workspace().exportHighlightsCsv(state.activeId);
}

export function speakerDisplayName(speakerId: string | null): string {
  if (!speakerId) return "Unknown speaker";
  const s = state.speakers.find((sp) => sp.speakerId === speakerId);
  return s?.displayName ?? s?.rawLabel ?? "Unknown speaker";
}

export const StoreContext = createContext<AppState>(state);

export function useAppState(): AppState {
  return useContext(StoreContext) ?? state;
}
