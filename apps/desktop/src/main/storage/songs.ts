/** Song repository — maps the `songs` table to `@timbrel/core` domain types. */
import { youtubeThumbnailUrl, type DetectedFeatures, type Song } from '@timbrel/core'
import { getDb } from './db'
import type { SongSummary } from '../../shared/ipc'

interface SongRow {
  id: string
  title: string
  artist: string | null
  duration_sec: number | null
  content_hash: string | null
  source_json: string
  features_json: string
  created_at: string
  separated_at: string | null
}

function toSong(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationSec: row.duration_sec,
    source: JSON.parse(row.source_json),
    contentHash: row.content_hash,
    features: JSON.parse(row.features_json),
    createdAt: row.created_at,
    separatedAt: row.separated_at
  }
}

interface SummaryRow {
  id: string
  title: string
  artist: string | null
  duration_sec: number | null
  bpm: number | null
  key: string | null
  created_at: string
  separated_at: string | null
  youtube_id: string | null
}

export function insert(song: Song): void {
  getDb()
    .prepare(
      `INSERT INTO songs
        (id, title, artist, duration_sec, content_hash, source_json, features_json, created_at, separated_at)
       VALUES
        (@id, @title, @artist, @durationSec, @contentHash, @sourceJson, @featuresJson, @createdAt, @separatedAt)`
    )
    .run({
      id: song.id,
      title: song.title,
      artist: song.artist,
      durationSec: song.durationSec,
      contentHash: song.contentHash,
      sourceJson: JSON.stringify(song.source),
      featuresJson: JSON.stringify(song.features),
      createdAt: song.createdAt,
      separatedAt: song.separatedAt
    })
}

export function findByHash(hash: string): Song | null {
  const row = getDb().prepare('SELECT * FROM songs WHERE content_hash = ?').get(hash) as
    | SongRow
    | undefined
  return row ? toSong(row) : null
}

export function get(id: string): Song | null {
  const row = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(id) as SongRow | undefined
  return row ? toSong(row) : null
}

export function list(): SongSummary[] {
  // bpm/key are pulled straight out of the JSON column so the (large, per-song)
  // beat arrays inside features_json are never read or parsed for the list.
  const rows = getDb()
    .prepare(
      `SELECT id, title, artist, duration_sec, created_at, separated_at,
              json_extract(features_json, '$.bpm') AS bpm,
              json_extract(features_json, '$.key') AS "key",
              json_extract(source_json, '$.youtubeId') AS youtube_id
         FROM songs ORDER BY created_at DESC`
    )
    .all() as SummaryRow[]
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationSec: row.duration_sec,
    bpm: row.bpm,
    key: row.key,
    separated: row.separated_at != null,
    createdAt: row.created_at,
    thumbnailUrl: row.youtube_id ? youtubeThumbnailUrl(row.youtube_id) : null
  }))
}

/** Remove a song's index row. FK cascade drops its `playlist_songs` rows too;
 *  the on-disk folder is deleted separately by the caller. */
export function remove(id: string): void {
  getDb().prepare('DELETE FROM songs WHERE id = ?').run(id)
}

export function markSeparated(
  id: string,
  features: DetectedFeatures,
  durationSec: number,
  separatedAt: string
): void {
  getDb()
    .prepare(
      `UPDATE songs
         SET features_json = @featuresJson,
             duration_sec = @durationSec,
             separated_at = @separatedAt
       WHERE id = @id`
    )
    .run({
      id,
      featuresJson: JSON.stringify(features),
      durationSec,
      separatedAt
    })
}
