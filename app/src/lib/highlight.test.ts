import { describe, expect, it } from "vitest";
import {
  coverRange,
  highlightText,
  resolveSpan,
  splitAtoms,
} from "./highlight";
import type { SegmentRow } from "./types";

const seg = (text: string): SegmentRow => ({
  segmentId: text,
  transcriptId: "t",
  speakerId: null,
  sequenceIndex: 0,
  startMs: 0,
  endMs: 0,
  text,
});

const segs = ["alpha beta", "gamma delta", "epsilon zeta", "eta theta"].map(seg);

describe("resolveSpan", () => {
  it("keeps a partial single-segment selection", () => {
    const s = resolveSpan(1, 1, 3, 8, segs);
    expect(s).toEqual({ lo: 1, hi: 1, startChar: 3, endChar: 8 });
  });

  it("treats endChar 0 as to-the-end on a single segment", () => {
    const s = resolveSpan(1, 1, 2, 0, segs);
    expect(s).toEqual({ lo: 1, hi: 1, startChar: 2, endChar: 11 });
  });

  it("keeps whole-segment legacy 0/0 rows untouched", () => {
    const s = resolveSpan(0, 0, 0, 0, segs);
    expect(s).toEqual({ lo: 0, hi: 0, startChar: 0, endChar: 10 });
  });

  it("keeps partial boundary offsets in a multi-segment span", () => {
    const s = resolveSpan(0, 2, 4, 7, segs);
    expect(s).toEqual({ lo: 0, hi: 2, startChar: 4, endChar: 7 });
  });

  it("shrinks when the selection starts at the end of segment lo", () => {
    const s = resolveSpan(0, 2, 10, 5, segs);
    expect(s).toEqual({ lo: 1, hi: 2, startChar: 0, endChar: 5 });
  });

  it("shrinks when the selection ends at the start of segment hi", () => {
    const s = resolveSpan(0, 2, 4, 0, segs);
    expect(s).toEqual({ lo: 0, hi: 1, startChar: 4, endChar: 0 });
  });

  it("degenerates to one whole segment when the selection only spans a boundary", () => {
    const s = resolveSpan(0, 1, 10, 0, segs);
    expect(s).toEqual({ lo: 1, hi: 1, startChar: 0, endChar: 11 });
  });

  it("clamps out-of-range offsets", () => {
    const s = resolveSpan(1, 1, -5, 99, segs);
    expect(s).toEqual({ lo: 1, hi: 1, startChar: 0, endChar: 11 });
  });
});

describe("highlightText", () => {
  it("slices a single partial segment", () => {
    const span = resolveSpan(1, 1, 3, 8, segs);
    expect(highlightText(segs, span)).toBe("ma de");
  });

  it("slices boundary segments and keeps middles whole", () => {
    const span = resolveSpan(0, 2, 6, 7, segs);
    expect(highlightText(segs, span)).toBe(
      ["beta", "gamma delta", "epsilon"].join("\n"),
    );
  });

  it("joins whole segments with newlines when both boundaries are full", () => {
    const span = resolveSpan(1, 2, 0, 12, segs);
    expect(highlightText(segs, span)).toBe("gamma delta\nepsilon zeta");
  });
});

describe("splitAtoms", () => {
  it("returns one atom without ranges", () => {
    expect(splitAtoms("abc", [])).toEqual([{ text: "abc", ids: [] }]);
  });

  it("splits around a partial range", () => {
    const atoms = splitAtoms("abcdefgh", [
      { annotationId: "a", from: 2, to: 5 },
    ]);
    expect(atoms).toEqual([
      { text: "ab", ids: [] },
      { text: "cde", ids: ["a"] },
      { text: "fgh", ids: [] },
    ]);
  });

  it("nests overlapping ranges and merges equal stacks", () => {
    const atoms = splitAtoms("abcdef", [
      { annotationId: "a", from: 0, to: 6 },
      { annotationId: "b", from: 1, to: 3 },
      { annotationId: "c", from: 3, to: 5 },
    ]);
    expect(atoms).toEqual([
      { text: "a", ids: ["a"] },
      { text: "bc", ids: ["a", "b"] },
      { text: "de", ids: ["a", "c"] },
      { text: "f", ids: ["a"] },
    ]);
  });
});

describe("coverRange", () => {
  it("uses offsets on the start segment", () => {
    const r = coverRange(
      { annotationId: "a", startSegmentId: "s", endSegmentId: "e", startCharOffset: 4, endCharOffset: 0 },
      "s",
      10,
    );
    expect(r).toEqual({ annotationId: "a", from: 4, to: 10 });
  });

  it("uses endCharOffset on the end segment", () => {
    const r = coverRange(
      { annotationId: "a", startSegmentId: "s", endSegmentId: "e", startCharOffset: 0, endCharOffset: 6 },
      "e",
      10,
    );
    expect(r).toEqual({ annotationId: "a", from: 0, to: 6 });
  });

  it("covers the whole middle segment", () => {
    const r = coverRange(
      { annotationId: "a", startSegmentId: "s", endSegmentId: "e", startCharOffset: 4, endCharOffset: 6 },
      "m",
      10,
    );
    expect(r).toEqual({ annotationId: "a", from: 0, to: 10 });
  });

  it("treats 0/0 as whole segment (legacy rows)", () => {
    const r = coverRange(
      { annotationId: "a", startSegmentId: "s", endSegmentId: "s", startCharOffset: 0, endCharOffset: 0 },
      "s",
      10,
    );
    expect(r).toEqual({ annotationId: "a", from: 0, to: 10 });
  });
});
