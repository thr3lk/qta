import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  extractSpeaker,
  guessParticipantName,
  guessSessionDatetime,
  parseTimestampMs,
  parseVtt,
} from "./vtt";

const sampleData = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../sample-data/${name}`, import.meta.url)), "utf8");

describe("parseTimestampMs", () => {
  it("parses hours form", () => {
    expect(parseTimestampMs("01:00:52.430")).toBe(3_652_430);
  });
  it("parses minutes form", () => {
    expect(parseTimestampMs("02:10.500")).toBe(130_500);
  });
  it("parses comma decimals", () => {
    expect(parseTimestampMs("00:00:02,170")).toBe(2_170);
  });
  it("rejects garbage", () => {
    expect(parseTimestampMs("nope")).toBeNull();
  });
});

describe("extractSpeaker", () => {
  it("extracts Meet-style name prefix", () => {
    const r = extractSpeaker("Marcus Webb: Sure.");
    expect(r.speaker).toBe("Marcus Webb");
    expect(r.text).toBe("Sure.");
  });
  it("extracts voice tags", () => {
    const r = extractSpeaker("<v Alex>hello there</v>");
    expect(r.speaker).toBe("Alex");
    expect(r.text).toBe("hello there");
  });
  it("returns null speaker when no plausible prefix", () => {
    expect(extractSpeaker("Sure, whatever you say: friend.").speaker).toBeNull();
  });
});

describe("parseVtt on sample data", () => {
  const sample = sampleData("GMT20250115-140000_Recording.transcript.vtt");
  const second = sampleData("Jordan Ellis - GMT20250114-100000_Recording.transcript.vtt");

  it("parses all cues from the Meet export", () => {
    const cues = parseVtt(sample);
    expect(cues.length).toBe(502);
    expect(cues[0].startMs).toBe(2170);
    expect(cues[0].endMs).toBe(10_060);
    expect(cues[0].speaker).toBe("Alex Donovan");
  });

  it("extracts multiple distinct speakers", () => {
    const cues = parseVtt(sample);
    const speakers = new Set(cues.map((c) => c.speaker));
    expect(speakers.has("Marcus Webb")).toBe(true);
    expect(speakers.has("Riley Chen")).toBe(true);
    expect(speakers.has(null)).toBe(false);
  });

  it("keeps sequence order and monotonically non-decreasing starts", () => {
    const cues = parseVtt(sample);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startMs).toBeGreaterThanOrEqual(cues[i - 1].startMs);
      expect(cues[i].sequenceIndex).toBe(i);
    }
  });

  it("parses the second sample file", () => {
    const cues = parseVtt(second);
    expect(cues.length).toBeGreaterThan(100);
    expect(cues[0].speaker).toBe("Alex Donovan");
  });
});

describe("Meet filename heuristics", () => {
  it("parses session datetime", () => {
    expect(
      guessSessionDatetime("GMT20250115-140000_Recording.transcript.vtt"),
    ).toBe("2025-01-15 14:00:00");
  });
  it("parses participant name", () => {
    expect(
      guessParticipantName("Jordan Ellis - GMT20250114-100000_Recording.transcript.vtt"),
    ).toBe("Jordan Ellis");
  });
  it("returns null when no participant prefix", () => {
    expect(guessParticipantName("GMT20250115-140000_Recording.transcript.vtt")).toBeNull();
  });
});
