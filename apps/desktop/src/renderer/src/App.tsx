import { useEffect, useState } from 'react'
import Home from './components/Home'
import Studio from './components/Studio'
import PlaylistDetail from './components/PlaylistDetail'
import SetupGate from './components/SetupGate'
import { OutputPanel } from './components/AudioOutput'
import { useRoutingStore } from './store/routingStore'

/**
 * Thin router. Three destinations — Home (search + library + playlists), a
 * playlist detail, and the Studio — plus the app-wide Audio Output panel
 * (rendered once here, opened from either header). A song opened from within a
 * playlist keeps the playlist selected, so "← Library" in the studio returns to
 * that playlist rather than Home. Everything sits behind the first-run
 * SetupGate until the separation engine is installed.
 */
function App(): React.JSX.Element {
  const [songId, setSongId] = useState<string | null>(null)
  const [playlistId, setPlaylistId] = useState<string | null>(null)

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
  } else {
    content = <Home onOpenSong={setSongId} onOpenPlaylist={setPlaylistId} />
  }

  return (
    <SetupGate>
      {content}
      <OutputPanel />
    </SetupGate>
  )
}

export default App
