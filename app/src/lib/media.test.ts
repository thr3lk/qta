import { describe, expect, it } from "vitest";
import { baseStem, isMediaFile, isVideoFile } from "./media";

describe("media pairing helpers", () => {
  it("strips .transcript suffix and extension from VTT names", () => {
    expect(baseStem("GMT20250115-140000_Recording.transcript.vtt")).toBe(
      "gmt20250115-140000_recording",
    );
  });

  it("matches plain media stems", () => {
    expect(baseStem("GMT20250115-140000_Recording.m4a")).toBe(
      "gmt20250115-140000_recording",
    );
    expect(baseStem("GMT20250115-140000_Recording_1920x1050.mp4")).toBe(
      "gmt20250115-140000_recording_1920x1050",
    );
  });

  it("classifies media files", () => {
    expect(isMediaFile("a.m4a")).toBe(true);
    expect(isMediaFile("a.mp4")).toBe(true);
    expect(isMediaFile("a.wav")).toBe(true);
    expect(isMediaFile("a.vtt")).toBe(false);
    expect(isMediaFile("a.txt")).toBe(false);
  });

  it("distinguishes video from audio", () => {
    expect(isVideoFile("a.mp4")).toBe(true);
    expect(isVideoFile("a.mov")).toBe(true);
    expect(isVideoFile("a.m4a")).toBe(false);
  });
});
