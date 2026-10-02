import type { ParsedCue } from "./types";

const TIMESTAMP_RE =
  /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$|^(\d{1,2}):(\d{2})[.,](\d{1,3})$/;

export function parseTimestampMs(raw: string): number | null {
  const s = raw.trim().replace(/\s*align.*$/i, "").trim();
  const m = TIMESTAMP_RE.exec(s);
  if (!m) return null;
  if (m[1] !== undefined) {
    return (
      (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 +
      Number(m[4].padEnd(3, "0"))
    );
  }
  return (Number(m[5]) * 60 + Number(m[6])) * 1000 + Number(m[7].padEnd(3, "0"));
}

const VOICE_TAG_RE = /^<v\s+([^>]+)>([\s\S]*)$/;
const SPEAKER_PREFIX_RE = /^([^:\n]{1,50}):\s+/;

export function extractSpeaker(text: string): {
  speaker: string | null;
  text: string;
} {
  const voice = VOICE_TAG_RE.exec(text);
  if (voice) {
    const inner = voice[2].replace(/<\/v>\s*$/i, "").trim();
    return { speaker: voice[1].trim() || null, text: inner };
  }
  const prefix = SPEAKER_PREFIX_RE.exec(text);
  if (
    prefix &&
    !prefix[1].includes("/") &&
    !prefix[1].includes(",") &&
    !prefix[1].includes("-->") &&
    !/[.,;!?]$/.test(prefix[1]) &&
    !/^\d/.test(prefix[1])
  ) {
    return { speaker: prefix[1].trim(), text: text.slice(prefix[0].length) };
  }
  return { speaker: null, text };
}

export function parseVtt(source: string): ParsedCue[] {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = text.split(/\n{2,}/);
  const cues: ParsedCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;

    const first = lines[0].trim();
    if (
      first.startsWith("WEBVTT") ||
      first.startsWith("NOTE") ||
      first.startsWith("STYLE") ||
      first.startsWith("REGION")
    ) {
      continue;
    }

    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx === -1) continue;

    const [rawStart, rawRest] = lines[timeIdx].split("-->");
    const rawEnd = (rawRest ?? "").trim().split(/\s+/)[0];
    const startMs = parseTimestampMs(rawStart ?? "");
    const endMs = parseTimestampMs(rawEnd);
    if (startMs === null || endMs === null) continue;

    const body = lines
      .slice(timeIdx + 1)
      .join("\n")
      .trim();
    if (body === "") continue;

    const { speaker, text: bodyText } = extractSpeaker(body);
    cues.push({
      sequenceIndex: cues.length,
      startMs,
      endMs,
      speaker,
      text: bodyText,
    });
  }

  return cues;
}

const MEET_SESSION_RE = /GMT(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/;

export function guessSessionDatetime(fileName: string): string | null {
  const m = MEET_SESSION_RE.exec(fileName);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

export function guessParticipantName(fileName: string): string | null {
  const dash = fileName.indexOf(" - ");
  if (dash <= 0) return null;
  const candidate = fileName.slice(0, dash).trim();
  return candidate.length > 0 && candidate.length <= 80 ? candidate : null;
}
