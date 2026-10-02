import type { SegmentRow } from "./types";

export interface SelectionSpan {
  lo: number;
  hi: number;
  startChar: number;
  endChar: number;
}

// Normalize a raw selection (segment indices plus char offsets into the
// boundary segments) into a highlight span. A selection that starts at the
// very end of segment `lo` or ends at the very start of segment `hi`
// contributes no characters there, so the span shrinks accordingly.
// Conventions: startChar 0 = highlight starts at the segment's first char;
// endChar 0 = highlight runs to the segment's last char (legacy whole-segment
// rows are stored as 0/0). endChar is only "to the end" when the selection
// actually reached it; otherwise it holds the exact offset.
export function resolveSpan(
  lo: number,
  hi: number,
  startChar: number,
  endChar: number,
  segments: SegmentRow[],
): SelectionSpan {
  if (lo > hi) [lo, hi, startChar, endChar] = [hi, lo, endChar, startChar];
  const clamp = (v: number, len: number) => Math.max(0, Math.min(v, len));
  if (lo < hi) {
    const startLen = segments[lo]?.text.length ?? 0;
    const endLen = segments[hi]?.text.length ?? 0;
    startChar = clamp(startChar, startLen);
    endChar = clamp(endChar, endLen);
    if (startChar >= startLen) {
      lo += 1;
      startChar = 0;
    }
    if (endChar <= 0) {
      hi -= 1;
      endChar = 0;
    }
    if (lo > hi) {
      hi = lo;
      endChar = segments[lo]?.text.length ?? 0;
    }
  } else {
    const len = segments[lo]?.text.length ?? 0;
    startChar = clamp(startChar, len);
    endChar = clamp(endChar, len);
    if (endChar === 0) endChar = len;
    if (startChar > endChar) startChar = endChar;
  }
  return { lo, hi, startChar, endChar };
}

// The highlight's text: partial content for boundary segments, full text for
// middle segments, joined with \n (cue breaks are meaningful downstream).
export function highlightText(
  segments: SegmentRow[],
  span: SelectionSpan,
): string {
  const seg = (i: number) => segments[i]?.text ?? "";
  if (span.lo === span.hi) {
    const t = seg(span.lo);
    return t.slice(span.startChar, span.endChar > 0 ? span.endChar : t.length);
  }
  const lines = [seg(span.lo).slice(span.startChar)];
  for (let i = span.lo + 1; i < span.hi; i++) lines.push(seg(i));
  const t = seg(span.hi);
  lines.push(t.slice(0, span.endChar > 0 ? span.endChar : t.length));
  return lines.join("\n");
}

export interface CoverRange {
  annotationId: string;
  from: number;
  to: number;
}

// Split `text` into runs ("atoms") at every highlight boundary. Each atom
// carries the ordered stack of annotations covering it, so the renderer can
// nest underline layers only where they actually apply. Adjacent atoms with
// identical stacks are merged to keep the DOM small.
export function splitAtoms(
  text: string,
  ranges: CoverRange[],
): { text: string; ids: string[] }[] {
  if (ranges.length === 0) return [{ text, ids: [] }];
  const cuts = new Set<number>([0, text.length]);
  for (const r of ranges) {
    cuts.add(Math.max(0, Math.min(r.from, text.length)));
    cuts.add(Math.max(0, Math.min(r.to, text.length)));
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const atoms: { text: string; ids: string[] }[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a >= b) continue;
    const ids = ranges
      .filter((r) => r.from <= a && b <= r.to)
      .map((r) => r.annotationId);
    atoms.push({ text: text.slice(a, b), ids });
  }
  const merged: { text: string; ids: string[] }[] = [];
  for (const atom of atoms) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.ids.length === atom.ids.length &&
      last.ids.every((id, j) => id === atom.ids[j])
    ) {
      last.text += atom.text;
    } else {
      merged.push({ text: atom.text, ids: [...atom.ids] });
    }
  }
  return merged;
}

// Per-segment highlight range for one annotation. startCharOffset 0 means
// "from the start"; endCharOffset 0 means "to the end" (legacy whole-segment
// rows and multi-segment middles).
export function coverRange(
  ann: { annotationId: string; startSegmentId: string; endSegmentId: string; startCharOffset: number; endCharOffset: number },
  segmentId: string,
  textLength: number,
): CoverRange {
  let from = 0;
  let to = textLength;
  if (ann.startSegmentId === segmentId) from = ann.startCharOffset;
  if (ann.endSegmentId === segmentId && ann.endCharOffset > 0) {
    to = ann.endCharOffset;
  }
  from = Math.max(0, Math.min(from, textLength));
  to = Math.max(from, Math.min(to, textLength));
  return { annotationId: ann.annotationId, from, to };
}
