const PALETTE = [
  "#e07a5f",
  "#3d8bfd",
  "#2a9d8f",
  "#9b5de5",
  "#f4a261",
  "#e76fa3",
  "#6a994e",
  "#d0a215",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function annotationColor(annotationId: string): string {
  return PALETTE[hashString(annotationId) % PALETTE.length];
}

export function speakerColor(speakerId: string): string {
  return PALETTE[hashString(speakerId) % PALETTE.length];
}
