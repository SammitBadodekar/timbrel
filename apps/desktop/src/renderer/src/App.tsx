import { useEffect, useState } from 'react'
import Home from './components/Home'
import Studio from './components/Studio'
import PlaylistDetail from './components/PlaylistDetail'
import SpotifyImport from './components/SpotifyImport'
import SetupGate from './components/SetupGate'
import { OutputPanel } from './components/AudioOutput'
import { useRoutingStore } from './store/routingStore'

/**
 * Thin router. Four destinations — Home (search + library + playlists), a
 * playlist detail, the Spotify import screen, and the Studio — plus the
 * app-wide Audio Output panel (rendered once here, opened from either header).
 * A song opened from within a playlist or the Spotify screen keeps that view
 * selected, so "← Library" in the studio returns there rather than Home.
 * Everything sits behind the first-run SetupGate until the separation engine
 * is installed.
 */
function App(): React.JSX.Element {
  const [songId, setSongId] = useState<string | null>(null)
  const [playlistId, setPlaylistId] = useState<string | null>(null)
  const [spotifyOpen, setSpotifyOpen] = useState(false)

  // Load the global output-routing rig + enumerate devices once, app-wide.
  useEffect(() => {
    void useRoutingStore.getState().init()
  }, [])

  let content: React.JSX.Element
  if (songId) {
    content = <Studio songId={songId} onBack={() => setSongId(null)} />
  } else if (playlistId) {
    content = (
      <PlaylistDetail
        playlistId={playlistId}
        onBack={() => setPlaylistId(null)}
        onOpenSong={setSongId}
      />
    )
  } else if (spotifyOpen) {
    content = <SpotifyImport onBack={() => setSpotifyOpen(false)} onOpenSong={setSongId} />
  } else {
    content = (
      <Home
        onOpenSong={setSongId}
        onOpenPlaylist={setPlaylistId}
        onOpenSpotify={() => setSpotifyOpen(true)}
      />
    )
  }

  return (
    <SetupGate>
      {content}
      <OutputPanel />
    </SetupGate>
  )
}

export default App
