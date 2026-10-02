import * as duckdb from "@duckdb/duckdb-wasm";
import ehWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import type {
  AnnotationRow,
  ParsedCue,
  SegmentRow,
  SpeakerRow,
  TagRow,
  TranscriptRow,
} from "./types";
import { speakerColor } from "./colors";

const DB_PATH = "opfs://qta.duckdb";
const SCHEMA_VERSION = "1";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR)`,
  `CREATE TABLE IF NOT EXISTS transcript (
    transcript_id UUID PRIMARY KEY,
    source_vtt_path VARCHAR,
    source_media_path VARCHAR,
    participant_name VARCHAR,
    interviewer_name VARCHAR,
    session_datetime TIMESTAMP,
    topic VARCHAR,
    duration_seconds DOUBLE,
    created_at TIMESTAMP,
    custom_metadata JSON
  )`,
  `CREATE TABLE IF NOT EXISTS speaker (
    speaker_id UUID PRIMARY KEY,
    transcript_id UUID,
    raw_label VARCHAR,
    display_name VARCHAR,
    color VARCHAR
  )`,
  `CREATE TABLE IF NOT EXISTS transcript_segment (
    segment_id UUID PRIMARY KEY,
    transcript_id UUID,
    speaker_id UUID,
    sequence_index INTEGER,
    start_ms INTEGER,
    end_ms INTEGER,
    text VARCHAR
  )`,
  `CREATE TABLE IF NOT EXISTS annotation (
    annotation_id UUID PRIMARY KEY,
    transcript_id UUID,
    kind VARCHAR,
    start_segment_id UUID,
    end_segment_id UUID,
    start_char_offset INTEGER,
    end_char_offset INTEGER,
    start_ms INTEGER,
    end_ms INTEGER,
    highlight_text VARCHAR,
    note VARCHAR,
    properties JSON,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS tag (
    tag_id UUID PRIMARY KEY,
    name VARCHAR UNIQUE,
    color VARCHAR
  )`,
  `CREATE TABLE IF NOT EXISTS annotation_tag (
    annotation_id UUID,
    tag_id UUID,
    PRIMARY KEY (annotation_id, tag_id)
  )`,
];

function esc(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function uuid(): string {
  return crypto.randomUUID();
}

interface RawRow {
  [key: string]: unknown;
}

function str(row: RawRow, key: string): string | null {
  const v = row[key];
  return v === null || v === undefined ? null : String(v);
}

function num(row: RawRow, key: string): number | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  return Number(v);
}

export interface Workspace {
  listTranscripts(): Promise<TranscriptRow[]>;
  importTranscript(
    fileName: string,
    cues: ParsedCue[],
    metadata: { participantName: string | null; sessionDatetime: string | null },
    mediaName?: string | null,
  ): Promise<string>;
  setMediaPath(transcriptId: string, mediaName: string | null): Promise<void>;
  loadTranscript(transcriptId: string): Promise<TranscriptRow | null>;
  loadSpeakers(transcriptId: string): Promise<SpeakerRow[]>;
  loadSegments(transcriptId: string): Promise<SegmentRow[]>;
  loadAnnotations(transcriptId: string): Promise<AnnotationRow[]>;
  loadTags(): Promise<TagRow[]>;
  createAnnotation(input: {
    transcriptId: string;
    startSegmentId: string;
    endSegmentId: string;
    startMs: number;
    endMs: number;
    highlightText: string;
  }): Promise<string>;
  updateAnnotationNote(annotationId: string, note: string): Promise<void>;
  updateAnnotationProperties(
    annotationId: string,
    properties: Record<string, unknown> | null,
  ): Promise<void>;
  deleteAnnotation(annotationId: string): Promise<void>;
  addTag(annotationName: string, annotationId: string): Promise<TagRow>;
  removeTag(annotationId: string, tagId: string): Promise<void>;
  renameSpeaker(speakerId: string, displayName: string): Promise<void>;
  exportHighlightsCsv(transcriptId: string): Promise<Uint8Array>;
}

let workspacePromise: Promise<Workspace> | null = null;

export function getWorkspace(): Promise<Workspace> {
  if (!workspacePromise) workspacePromise = openWorkspace();
  return workspacePromise;
}

async function openWorkspace(): Promise<Workspace> {
  const bundle = {
    mainModule: ehWasmUrl,
    mainWorker: ehWorkerUrl,
    pthreadWorker: null,
  } as unknown as duckdb.DuckDBBundle;
  const worker = new Worker(bundle.mainWorker as string);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule);
  await db.open({
    path: DB_PATH,
    accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
    opfs: { fileHandling: "auto" },
  });
  const conn = await db.connect();

  for (const stmt of SCHEMA_STATEMENTS) {
    await conn.query(stmt);
  }
  const version = await conn.query(
    `SELECT count(*) AS n FROM meta WHERE key = 'schema_version'`,
  );
  if (Number((version.toArray()[0] as RawRow).n) === 0) {
    await conn.query(
      `INSERT INTO meta VALUES ('schema_version', '${SCHEMA_VERSION}')`,
    );
  }

  async function query(sql: string): Promise<RawRow[]> {
    const result = await conn.query(sql);
    return result.toArray() as unknown as RawRow[];
  }

  async function checkpoint(): Promise<void> {
    await conn.query("CHECKPOINT");
  }

  const ws: Workspace = {
    async listTranscripts() {
      const rows = await query(`
        SELECT CAST(t.transcript_id AS VARCHAR) AS "transcriptId",
               t.source_vtt_path AS "sourceVttPath",
               t.source_media_path AS "sourceMediaPath",
               t.participant_name AS "participantName",
               t.interviewer_name AS "interviewerName",
               CAST(t.session_datetime AS VARCHAR) AS "sessionDatetime",
               t.topic AS "topic",
               t.duration_seconds AS "durationSeconds",
               CAST(t.created_at AS VARCHAR) AS "createdAt"
        FROM transcript t
        ORDER BY t.created_at DESC
      `);
      return rows.map((r) => ({
        transcriptId: String(r.transcriptId),
        sourceVttPath: String(r.sourceVttPath ?? ""),
        sourceMediaPath: str(r, "sourceMediaPath"),
        participantName: str(r, "participantName"),
        interviewerName: str(r, "interviewerName"),
        sessionDatetime: str(r, "sessionDatetime"),
        topic: str(r, "topic"),
        durationSeconds: num(r, "durationSeconds"),
        createdAt: String(r.createdAt ?? ""),
      }));
    },

    async importTranscript(fileName, cues, metadata, mediaName = null) {
      const transcriptId = uuid();
      const durationSeconds = cues.length ? cues[cues.length - 1].endMs / 1000 : 0;
      await query(`
        INSERT INTO transcript (
          transcript_id, source_vtt_path, source_media_path, participant_name,
          interviewer_name, session_datetime, topic, duration_seconds, created_at
        ) VALUES (
          '${transcriptId}', ${esc(fileName)}, ${esc(mediaName)}, ${esc(metadata.participantName)},
          NULL, ${esc(metadata.sessionDatetime)}, NULL, ${durationSeconds},
          CAST(now() AS TIMESTAMP)
        )
      `);

      const speakerIds = new Map<string, string>();
      let colorIdx = 0;
      for (const cue of cues) {
        if (cue.speaker === null || speakerIds.has(cue.speaker)) continue;
        const speakerId = uuid();
        speakerIds.set(cue.speaker, speakerId);
        await query(`
          INSERT INTO speaker (speaker_id, transcript_id, raw_label, display_name, color)
          VALUES ('${speakerId}', '${transcriptId}', ${esc(cue.speaker)}, ${esc(cue.speaker)}, ${esc(speakerColor(speakerId))})
        `);
        colorIdx++;
      }

      const CHUNK = 200;
      for (let i = 0; i < cues.length; i += CHUNK) {
        const chunk = cues.slice(i, i + CHUNK);
        const values = chunk
          .map((cue) => {
            const speakerId = cue.speaker === null ? null : speakerIds.get(cue.speaker);
            return `('${uuid()}', '${transcriptId}', ${
              speakerId === undefined ? "NULL" : esc(speakerId)
            }, ${cue.sequenceIndex}, ${cue.startMs}, ${cue.endMs}, ${esc(cue.text)})`;
          })
          .join(",\n");
        await query(`
          INSERT INTO transcript_segment (
            segment_id, transcript_id, speaker_id, sequence_index, start_ms, end_ms, text
          ) VALUES ${values}
        `);
      }
      return transcriptId;
    },

    async setMediaPath(transcriptId, mediaName) {
      await query(`
        UPDATE transcript
        SET source_media_path = ${esc(mediaName)}
        WHERE transcript_id = '${transcriptId}'
      `);
      await checkpoint();
    },

    async loadTranscript(transcriptId) {
      const rows = await query(`
        SELECT CAST(t.transcript_id AS VARCHAR) AS "transcriptId",
               t.source_vtt_path AS "sourceVttPath",
               t.source_media_path AS "sourceMediaPath",
               t.participant_name AS "participantName",
               t.interviewer_name AS "interviewerName",
               CAST(t.session_datetime AS VARCHAR) AS "sessionDatetime",
               t.topic AS "topic",
               t.duration_seconds AS "durationSeconds",
               CAST(t.created_at AS VARCHAR) AS "createdAt"
        FROM transcript t
        WHERE t.transcript_id = '${transcriptId}'
      `);
      const r = rows[0];
      if (!r) return null;
      return {
        transcriptId: String(r.transcriptId),
        sourceVttPath: String(r.sourceVttPath ?? ""),
        sourceMediaPath: str(r, "sourceMediaPath"),
        participantName: str(r, "participantName"),
        interviewerName: str(r, "interviewerName"),
        sessionDatetime: str(r, "sessionDatetime"),
        topic: str(r, "topic"),
        durationSeconds: num(r, "durationSeconds"),
        createdAt: String(r.createdAt ?? ""),
      };
    },

    async loadSpeakers(transcriptId) {
      const rows = await query(`
        SELECT CAST(s.speaker_id AS VARCHAR) AS "speakerId",
               CAST(s.transcript_id AS VARCHAR) AS "transcriptId",
               s.raw_label AS "rawLabel",
               s.display_name AS "displayName",
               s.color AS "color"
        FROM speaker s
        WHERE s.transcript_id = '${transcriptId}'
        ORDER BY s.raw_label
      `);
      return rows.map((r) => ({
        speakerId: String(r.speakerId),
        transcriptId: String(r.transcriptId),
        rawLabel: str(r, "rawLabel"),
        displayName: str(r, "displayName"),
        color: str(r, "color"),
      }));
    },

    async loadSegments(transcriptId) {
      const rows = await query(`
        SELECT CAST(seg.segment_id AS VARCHAR) AS "segmentId",
               CAST(seg.transcript_id AS VARCHAR) AS "transcriptId",
               CAST(seg.speaker_id AS VARCHAR) AS "speakerId",
               seg.sequence_index AS "sequenceIndex",
               seg.start_ms AS "startMs",
               seg.end_ms AS "endMs",
               seg.text AS "text"
        FROM transcript_segment seg
        WHERE seg.transcript_id = '${transcriptId}'
        ORDER BY seg.sequence_index
      `);
      return rows.map((r) => ({
        segmentId: String(r.segmentId),
        transcriptId: String(r.transcriptId),
        speakerId: str(r, "speakerId"),
        sequenceIndex: Number(r.sequenceIndex),
        startMs: Number(r.startMs),
        endMs: Number(r.endMs),
        text: String(r.text ?? ""),
      }));
    },

    async loadAnnotations(transcriptId) {
      const annRows = await query(`
        SELECT CAST(a.annotation_id AS VARCHAR) AS "annotationId",
               CAST(a.transcript_id AS VARCHAR) AS "transcriptId",
               a.kind AS "kind",
               CAST(a.start_segment_id AS VARCHAR) AS "startSegmentId",
               CAST(a.end_segment_id AS VARCHAR) AS "endSegmentId",
               a.start_char_offset AS "startCharOffset",
               a.end_char_offset AS "endCharOffset",
               a.start_ms AS "startMs",
               a.end_ms AS "endMs",
               a.highlight_text AS "highlightText",
               a.note AS "note",
               CAST(a.properties AS VARCHAR) AS "propertiesJson",
               CAST(a.created_at AS VARCHAR) AS "createdAt",
               CAST(a.updated_at AS VARCHAR) AS "updatedAt"
        FROM annotation a
        WHERE a.transcript_id = '${transcriptId}'
        ORDER BY a.start_ms, a.created_at, a.annotation_id
      `);
      const linkRows = await query(`
        SELECT CAST(x.annotation_id AS VARCHAR) AS "annotationId",
               CAST(x.tag_id AS VARCHAR) AS "tagId",
               tg.name AS "tagName"
        FROM annotation_tag x
        JOIN annotation a ON a.annotation_id = x.annotation_id
        JOIN tag tg ON tg.tag_id = x.tag_id
        WHERE a.transcript_id = '${transcriptId}'
      `);
      const tagRows: TagRow[] = await ws.loadTags();
      const tagById = new Map(tagRows.map((t) => [t.tagId, t]));

      return annRows.map((r) => {
        const annotationId = String(r.annotationId);
        const tags = linkRows
          .filter((l) => l.annotationId === annotationId)
          .map((l) => tagById.get(String(l.tagId)))
          .filter((t): t is TagRow => t !== undefined);
        const propertiesJson = str(r, "propertiesJson");
        let properties: Record<string, unknown> | null = null;
        if (propertiesJson) {
          try {
            properties = JSON.parse(propertiesJson) as Record<string, unknown>;
          } catch {
            properties = null;
          }
        }
        return {
          annotationId,
          transcriptId: String(r.transcriptId),
          kind: String(r.kind ?? "highlight"),
          startSegmentId: String(r.startSegmentId),
          endSegmentId: String(r.endSegmentId),
          startCharOffset: Number(r.startCharOffset ?? 0),
          endCharOffset: Number(r.endCharOffset ?? 0),
          startMs: Number(r.startMs),
          endMs: Number(r.endMs),
          highlightText: String(r.highlightText ?? ""),
          note: str(r, "note"),
          properties,
          createdAt: String(r.createdAt ?? ""),
          updatedAt: String(r.updatedAt ?? ""),
          tags,
        };
      });
    },

    async loadTags() {
      const rows = await query(`
        SELECT CAST(t.tag_id AS VARCHAR) AS "tagId", t.name AS "name", t.color AS "color"
        FROM tag t
        ORDER BY t.name
      `);
      return rows.map((r) => ({
        tagId: String(r.tagId),
        name: String(r.name),
        color: str(r, "color"),
      }));
    },

    async createAnnotation(input) {
      const id = uuid();
      await query(`
        INSERT INTO annotation (
          annotation_id, transcript_id, kind, start_segment_id, end_segment_id,
          start_char_offset, end_char_offset, start_ms, end_ms, highlight_text,
          note, properties, created_at, updated_at
        ) VALUES (
          '${id}', '${input.transcriptId}', 'highlight',
          '${input.startSegmentId}', '${input.endSegmentId}', 0, 0,
          ${input.startMs}, ${input.endMs}, ${esc(input.highlightText)},
          NULL, NULL, CAST(now() AS TIMESTAMP), CAST(now() AS TIMESTAMP)
        )
      `);
      return id;
      await checkpoint();
    },

    async updateAnnotationNote(annotationId, note) {
      await query(`
        UPDATE annotation
        SET note = ${esc(note.trim() === "" ? null : note)}, updated_at = CAST(now() AS TIMESTAMP)
        WHERE annotation_id = '${annotationId}'
      `);
      await checkpoint();
    },

    async updateAnnotationProperties(annotationId, properties) {
      const json =
        properties === null || Object.keys(properties).length === 0
          ? "NULL"
          : `${esc(JSON.stringify(properties))}::JSON`;
      await query(`
        UPDATE annotation
        SET properties = ${json}, updated_at = CAST(now() AS TIMESTAMP)
        WHERE annotation_id = '${annotationId}'
      `);
      await checkpoint();
    },

    async deleteAnnotation(annotationId) {
      await query(
        `DELETE FROM annotation_tag WHERE annotation_id = '${annotationId}'`,
      );
      await query(`DELETE FROM annotation WHERE annotation_id = '${annotationId}'`);
      await checkpoint();
    },

    async addTag(annotationName, annotationId) {
      const name = annotationName.trim();
      if (name === "") throw new Error("empty tag name");
      const existing = await query(
        `SELECT CAST(t.tag_id AS VARCHAR) AS "tagId" FROM tag t WHERE t.name = ${esc(name)}`,
      );
      let tagId: string;
      if (existing.length > 0) {
        tagId = String(existing[0].tagId);
      } else {
        tagId = uuid();
        await query(
          `INSERT INTO tag (tag_id, name) VALUES ('${tagId}', ${esc(name)})`,
        );
      }
      await query(`
        INSERT INTO annotation_tag (annotation_id, tag_id)
        VALUES ('${annotationId}', '${tagId}')
        ON CONFLICT DO NOTHING
      `);
      return { tagId, name, color: null };
      await checkpoint();
    },

    async removeTag(annotationId, tagId) {
      await query(
        `DELETE FROM annotation_tag WHERE annotation_id = '${annotationId}' AND tag_id = '${tagId}'`,
      );
      await checkpoint();
    },

    async renameSpeaker(speakerId, displayName) {
      const name = displayName.trim();
      await query(`
        UPDATE speaker
        SET display_name = ${name === "" ? "NULL" : esc(name)}
        WHERE speaker_id = '${speakerId}'
      `);
      await checkpoint();
    },

    async exportHighlightsCsv(transcriptId) {
      const exportPath = "opfs://exports/highlights.csv";
      const root = await navigator.storage.getDirectory();
      try {
        const exportsDir = await root.getDirectoryHandle("exports");
        await exportsDir.removeEntry("highlights.csv");
      } catch {
        // directory or file may not exist yet
      }
      await query(`
        COPY (
          SELECT
            COALESCE(t.participant_name, '') AS "transcript_participant",
            COALESCE(t.interviewer_name, '') AS "transcript_interviewer",
            COALESCE(t.topic, '') AS "transcript_topic",
            COALESCE(CAST(t.session_datetime AS VARCHAR), '') AS "transcript_session_datetime",
            COALESCE(s.display_name, '') AS "speaker_display_name",
            a.start_ms AS "start_ms",
            a.end_ms AS "end_ms",
            a.highlight_text AS "highlight_text",
            COALESCE(a.note, '') AS "note",
            COALESCE((
              SELECT string_agg(tg.name, ',')
              FROM annotation_tag x
              JOIN tag tg ON tg.tag_id = x.tag_id
              WHERE x.annotation_id = a.annotation_id
            ), '') AS "tags",
            COALESCE(CAST(a.properties AS VARCHAR), '') AS "properties",
            'qda://transcript/' || CAST(t.transcript_id AS VARCHAR) || '/highlight/' || CAST(a.annotation_id AS VARCHAR) AS "highlight_uri"
          FROM annotation a
          JOIN transcript t ON t.transcript_id = a.transcript_id
          JOIN transcript_segment seg_start ON seg_start.segment_id = a.start_segment_id
          LEFT JOIN speaker s ON s.speaker_id = seg_start.speaker_id
          WHERE a.transcript_id = '${transcriptId}' AND a.kind = 'highlight'
          ORDER BY a.start_ms, a.created_at, a.annotation_id
        ) TO '${exportPath}' (HEADER, DELIMITER ',')
      `);
      const exportsDir = await root.getDirectoryHandle("exports");
      const fileHandle = await exportsDir.getFileHandle("highlights.csv");
      const file = await fileHandle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      await exportsDir.removeEntry("highlights.csv");
      const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
      const out = new Uint8Array(bom.length + bytes.length);
      out.set(bom, 0);
      out.set(bytes, bom.length);
      return out;
    },
  };

  return ws;
}
