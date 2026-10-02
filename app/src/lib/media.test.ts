import { describe, expect, it } from "vitest";
import { baseStem, isMediaFile, isVideoFile, mediaMatches, pickMedia } from "./media";

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

describe("media matching for real-world recording names", () => {
  const vtt1 = "GMT20250115-140000_Recording.transcript.vtt";
  const mp4a = "GMT20250115-140000_Recording_1920x1050.mp4";
  const vtt2 = "Jordan Ellis - GMT20250114-100000_Recording.transcript.vtt";
  const mp4b = "Jordan Ellis - GMT20250114-100000_Recording_2240x1260.mp4";
  const m4ab = "Jordan Ellis - GMT20250114-100000_Recording.m4a";

  it("matches media with resolution suffixes", () => {
    expect(mediaMatches(vtt1, mp4a)).toBe(true);
    expect(mediaMatches(vtt2, mp4b)).toBe(true);
  });

  it("matches exact-stem audio", () => {
    expect(mediaMatches(vtt2, m4ab)).toBe(true);
  });

  it("does not match unrelated names that merely share a prefix", () => {
    expect(mediaMatches("Session1.transcript.vtt", "Session12.mp4")).toBe(false);
  });

  it("prefers video even when audio matches exactly", () => {
    const picked = pickMedia(vtt2, [
      { name: m4ab },
      { name: mp4b },
    ]);
    expect(picked?.name).toBe(mp4b);
  });

  it("prefers exact stem over prefixed within the same media class", () => {
    const picked = pickMedia(vtt2, [
      { name: "Jordan Ellis - GMT20250114-100000_Recording_copy.m4a" },
      { name: m4ab },
    ]);
    expect(picked?.name).toBe(m4ab);
  });

  it("returns the only candidate when just one matches", () => {
    expect(pickMedia(vtt1, [{ name: mp4a }])?.name).toBe(mp4a);
  });

  it("returns null when nothing matches", () => {
    expect(pickMedia(vtt1, [{ name: "other.m4a" }])).toBeNull();
  });
});
