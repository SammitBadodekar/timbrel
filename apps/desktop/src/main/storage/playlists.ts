/**
 * Playlist repository — maps the `playlists` + `playlist_songs` tables to the
 * `@timbrel/core` domain types. Membership is a join, so a playlist delete never
 * touches the songs (the whole point); duration/counts for the shelf are derived
 * with joins against `songs` rather than duplicated.
 */
import { youtubeThumbnailUrl, type PlaylistSummary } from '@timbrel/core'
import { getDb } from './db'
import type { PlaylistDetail } from '../../shared/ipc'

interface SummaryRow {
  id: string
  name: string
  created_at: string
  updated_at: string
  track_count: number
  duration_sec: number | null
}

interface MemberRow {
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

interface CoverRow {
  id: string
  title: string
  youtube_id: string | null
}

function now(): string {
  return new Date().toISOString()
}

/** All playlists with derived counts + up-to-four cover song ids, newest first. */
export function list(): PlaylistSummary[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.created_at, p.updated_at,
              COUNT(ps.song_id)  AS track_count,
              SUM(s.duration_sec) AS duration_sec
         FROM playlists p
         LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
         LEFT JOIN songs s           ON s.id = ps.song_id
        GROUP BY p.id
        ORDER BY p.updated_at DESC`
    )
    .all() as SummaryRow[]

  const coverStmt = db.prepare(
    `SELECT s.id, s.title, json_extract(s.source_json, '$.youtubeId') AS youtube_id
       FROM playlist_songs ps
       JOIN songs s ON s.id = ps.song_id
      WHERE ps.playlist_id = ? ORDER BY ps.position ASC LIMIT 4`
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trackCount: row.track_count,
    durationSec: row.duration_sec,
    coverSongs: (coverStmt.all(row.id) as CoverRow[]).map((c) => ({
      id: c.id,
      title: c.title,
      thumbnailUrl: c.youtube_id ? youtubeThumbnailUrl(c.youtube_id) : null
    }))
  }))
}

/** One playlist with its ordered members, or null if it doesn't exist. */
export function get(id: string): PlaylistDetail | null {
  const db = getDb()
  const meta = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as
    | { id: string; name: string; created_at: string; updated_at: string }
    | undefined
  if (!meta) return null

  const rows = db
    .prepare(
      `SELECT s.id, s.title, s.artist, s.duration_sec, s.created_at, s.separated_at,
              json_extract(s.features_json, '$.bpm') AS bpm,
              json_extract(s.features_json, '$.key') AS "key",
              json_extract(s.source_json, '$.youtubeId') AS youtube_id
         FROM playlist_songs ps
         JOIN songs s ON s.id = ps.song_id
        WHERE ps.playlist_id = ?
        ORDER BY ps.position ASC`
    )
    .all(id) as MemberRow[]

  return {
    id: meta.id,
    name: meta.name,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
    songs: rows.map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      durationSec: r.duration_sec,
      bpm: r.bpm,
      key: r.key,
      separated: r.separated_at != null,
      createdAt: r.created_at,
      thumbnailUrl: r.youtube_id ? youtubeThumbnailUrl(r.youtube_id) : null
    }))
  }
}

export function create(id: string, name: string): void {
  const ts = now()
  getDb()
    .prepare('INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, ts, ts)
}

export function rename(id: string, name: string): void {
  getDb().prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id)
}

export function remove(id: string): void {
  // FK cascade clears this playlist's membership rows; songs are untouched.
  getDb().prepare('DELETE FROM playlists WHERE id = ?').run(id)
}

/** Add songs to a playlist (append), skipping any already present. */
export function addSongs(playlistId: string, songIds: string[]): void {
  const db = getDb()
  const ts = now()
  const maxPos =
    (
      db
        .prepare('SELECT MAX(position) AS m FROM playlist_songs WHERE playlist_id = ?')
        .get(playlistId) as { m: number | null }
    ).m ?? -1

  const insert = db.prepare(
    `INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position, added_at)
     VALUES (?, ?, ?, ?)`
  )
  const touch = db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?')
  const tx = db.transaction((ids: string[]) => {
    let pos = maxPos
    for (const songId of ids) insert.run(playlistId, songId, ++pos, ts)
    touch.run(ts, playlistId)
  })
  tx(songIds)
}

/** Remove one song from a playlist (leaves the song itself intact). */
export function removeSong(playlistId: string, songId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?').run(
    playlistId,
    songId
  )
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), playlistId)
}

/** Persist a new order for a playlist's members (full ordered id list). */
export function reorder(playlistId: string, orderedSongIds: string[]): void {
  const db = getDb()
  const ts = now()
  const set = db.prepare(
    'UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND song_id = ?'
  )
  const touch = db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?')
  const tx = db.transaction((ids: string[]) => {
    ids.forEach((songId, i) => set.run(i, playlistId, songId))
    touch.run(ts, playlistId)
  })
  tx(orderedSongIds)
}
