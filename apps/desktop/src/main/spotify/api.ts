/**
 * Thin authenticated client over the Spotify Web API — metadata reads only
 * (playlists, liked songs, tracks). Everything is normalized to the `@timbrel/core`
 * shapes here so the renderer never sees Spotify's raw JSON. Pages are followed
 * to completion, bounded by a safety cap so a huge library can't hang the app.
 */
import { SPOTIFY_API_BASE, type SpotifyPlaylist, type SpotifyTrack } from '@timbrel/core'
import { getAccessToken } from './auth'

/** Hard cap on pages followed per call (50×100 = 5000 tracks). */
const MAX_PAGES = 50

interface Paged<T> {
  items: T[]
  next: string | null
}

interface RawImage {
  url: string
}
interface RawPlaylist {
  id: string
  name: string
  images: RawImage[] | null
  owner: { display_name?: string; id?: string } | null
  collaborative?: boolean
}
interface RawTrack {
  id: string
  name: string
  duration_ms: number | null
  artists: { name: string }[] | null
  album: { name?: string; images?: RawImage[] } | null
  external_ids?: { isrc?: string }
}

async function api<T>(url: string): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(url.startsWith('http') ? url : `${SPOTIFY_API_BASE}${url}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.status === 429) {
    const retry = res.headers.get('retry-after')
    throw new Error(`Spotify rate limit reached${retry ? ` — try again in ${retry}s` : ''}.`)
  }
  if (res.status === 401) {
    throw new Error('Spotify session expired — please reconnect.')
  }
  if (res.status === 403) {
    // Spotify only serves tracks for playlists the user owns or collaborates on.
    throw new Error(
      "Spotify won't share this playlist's tracks. Only playlists you own or collaborate on can be imported — followed and Spotify-made playlists (Discover Weekly, Daily Mix, editorial) are blocked."
    )
  }
  if (!res.ok) {
    throw new Error(`Spotify API error ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as T
}

function mapTrack(t: RawTrack): SpotifyTrack {
  return {
    id: t.id,
    name: t.name,
    artists: (t.artists ?? []).map((a) => a.name),
    album: t.album?.name ?? null,
    durationSec: t.duration_ms != null ? t.duration_ms / 1000 : null,
    isrc: t.external_ids?.isrc ?? null,
    imageUrl: t.album?.images?.[0]?.url ?? null
  }
}

export async function getPlaylists(): Promise<SpotifyPlaylist[]> {
  const out: SpotifyPlaylist[] = []
  let url: string | null = `${SPOTIFY_API_BASE}/me/playlists?limit=50`
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const data: Paged<RawPlaylist | null> = await api(url)
    for (const p of data.items) {
      if (!p) continue // Spotify occasionally returns null entries
      out.push({
        id: p.id,
        name: p.name,
        imageUrl: p.images?.[0]?.url ?? null,
        owner: p.owner?.display_name ?? null,
        ownerId: p.owner?.id ?? null,
        collaborative: !!p.collaborative
      })
    }
    url = data.next
  }
  return out
}

export async function getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
  // Spotify migrated playlist items from `/tracks` (now 403s for most apps —
  // even the user's OWN playlists) to `/items`, where the track/episode is
  // nested under `item` (not `track`). `/me/tracks` (liked) was NOT migrated.
  const fields =
    'next,items(item(id,name,duration_ms,album(name,images),artists(name),external_ids(isrc)))'
  const out: SpotifyTrack[] = []
  let url: string | null =
    `${SPOTIFY_API_BASE}/playlists/${playlistId}/items?limit=100&fields=${encodeURIComponent(fields)}`
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const data: Paged<{ item: RawTrack | null }> = await api(url)
    for (const entry of data.items) {
      if (entry?.item?.id) out.push(mapTrack(entry.item))
    }
    url = data.next
  }
  return out
}

export async function getLikedTracks(): Promise<SpotifyTrack[]> {
  const out: SpotifyTrack[] = []
  let url: string | null = `${SPOTIFY_API_BASE}/me/tracks?limit=50`
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const data: Paged<{ track: RawTrack | null }> = await api(url)
    for (const item of data.items) {
      if (item?.track?.id) out.push(mapTrack(item.track))
    }
    url = data.next
  }
  return out
}
