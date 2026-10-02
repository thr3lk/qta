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
