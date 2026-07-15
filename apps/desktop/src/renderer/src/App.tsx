import { useEffect, useState } from 'react'
import Home from './components/Home'
import Studio from './components/Studio'
import PlaylistDetail from './components/PlaylistDetail'
import SpotifyImport from './components/SpotifyImport'
import SetupGate from './components/SetupGate'
import { OutputPanel } from './components/AudioOutput'
import { ConcertLightsController, ConcertLightsPanel } from './components/ConcertLights'
import { useRoutingStore } from './store/routingStore'
import { useConcertLightsStore } from './store/concertLightsStore'
import { useStudioStore } from './store/studioStore'

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select, button, a[href]'))
  )
}

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
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)

  // Load the global output-routing rig + enumerate devices once, app-wide.
  useEffect(() => {
    void useRoutingStore.getState().init()
    useConcertLightsStore.getState().init()
  }, [])

  // App-wide keyboard gestures. Command/Ctrl+K always returns to and focuses
  // the omnibox; transport gestures are active whenever a Studio is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSongId(null)
        setPlaylistId(null)
        setSpotifyOpen(false)
        setSearchFocusRequest((request) => request + 1)
        return
      }

      if (
        !songId ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return
      }

      const studio = useStudioStore.getState()
      switch (event.key.toLowerCase()) {
        case ' ':
          event.preventDefault()
          if (!event.repeat) void studio.togglePlay()
          break
        case 'arrowleft':
          event.preventDefault()
          studio.seek(studio.currentTime + (event.shiftKey ? -15 : -5))
          break
        case 'arrowright':
          event.preventDefault()
          studio.seek(studio.currentTime + (event.shiftKey ? 15 : 5))
          break
        case 'home':
          event.preventDefault()
          studio.seek(0)
          break
        case 'end':
          event.preventDefault()
          studio.seek(studio.duration)
          break
        case 'l':
          if (!event.repeat) studio.toggleLoop()
          break
        case 'm':
          if (!event.repeat) studio.toggleMetronome()
          break
        case 'c':
          if (!event.repeat) studio.toggleCountIn()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [songId])

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
        searchFocusRequest={searchFocusRequest}
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
      <ConcertLightsPanel />
      <ConcertLightsController />
    </SetupGate>
  )
}

export default App
