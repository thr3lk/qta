export interface TranscriptRow {
  transcriptId: string;
  sourceVttPath: string;
  sourceMediaPath: string | null;
  participantName: string | null;
  interviewerName: string | null;
  sessionDatetime: string | null;
  topic: string | null;
  durationSeconds: number | null;
  createdAt: string;
}

export interface SpeakerRow {
  speakerId: string;
  transcriptId: string;
  rawLabel: string | null;
  displayName: string | null;
  color: string | null;
}

export interface SegmentRow {
  segmentId: string;
  transcriptId: string;
  speakerId: string | null;
  sequenceIndex: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TagRow {
  tagId: string;
  name: string;
  color: string | null;
}

export interface AnnotationRow {
  annotationId: string;
  transcriptId: string;
  kind: string;
  startSegmentId: string;
  endSegmentId: string;
  startCharOffset: number;
  endCharOffset: number;
  startMs: number;
  endMs: number;
  highlightText: string;
  note: string | null;
  properties: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  tags: TagRow[];
}

export interface ParsedCue {
  sequenceIndex: number;
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
}
