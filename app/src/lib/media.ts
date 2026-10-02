const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "mkv"];
const AUDIO_EXTENSIONS = ["m4a", "mp3", "wav", "aac", "ogg", "m4b", "flac", "opus"];

export const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isMediaFile(name: string): boolean {
  return MEDIA_EXTENSIONS.includes(extensionOf(name));
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.includes(extensionOf(name));
}

export function baseStem(name: string): string {
  const lower = name.toLowerCase();
  let stem = lower.replace(/\.[a-z0-9]+$/, "");
  stem = stem.replace(/\.transcript$/, "");
  return stem;
}

export function mediaMatches(vttName: string, mediaName: string): boolean {
  const v = baseStem(vttName);
  const m = baseStem(mediaName);
  return m === v || m.startsWith(`${v}_`);
}

export function pickMedia<T extends { name: string }>(
  vttName: string,
  candidates: T[],
): T | null {
  const matches = candidates.filter((c) => mediaMatches(vttName, c.name));
  if (matches.length === 0) return null;
  const score = (c: T): number => {
    const vttStem = baseStem(vttName);
    const exact = baseStem(c.name) === vttStem ? 1 : 0;
    return (isVideoFile(c.name) ? 2 : 0) + exact;
  };
  return [...matches].sort((a, b) => score(b) - score(a))[0];
}
