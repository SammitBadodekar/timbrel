import { useCallback, useEffect, useState } from 'react'
import type { SongSummary } from '@shared/ipc'
import type { JobUi } from './types'
import Library from './components/Library'
import Studio from './components/Studio'
import Search from './components/Search'
import AudioOutput from './components/AudioOutput'
import { useRoutingStore } from './store/routingStore'

function App(): React.JSX.Element {
  const [songs, setSongs] = useState<SongSummary[]>([])
  const [jobs, setJobs] = useState<Record<string, JobUi>>({})
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const refreshSongs = useCallback(async () => {
    setSongs(await window.timbrel.listSongs())
  }, [])

  // Load the global output-routing rig + enumerate devices once, app-wide.
  useEffect(() => {
    void useRoutingStore.getState().init()
  }, [])

  useEffect(() => {
    void window.timbrel.listSongs().then(setSongs)

    const unsubscribe = window.timbrel.onSeparationEvent((event) => {
      if (event.type === 'progress') {
        setJobs((j) => ({
          ...j,
          [event.songId]: { stage: event.stage, progress: event.progress, message: event.message }
        }))
      } else if (event.type === 'done') {
        setJobs((j) => {
          const next = { ...j }
          delete next[event.songId]
          return next
        })
        void refreshSongs()
      } else if (event.type === 'error' && event.songId) {
        setJobs((j) => ({
          ...j,
          [event.songId!]: { stage: 'queued', progress: 0, error: event.message }
        }))
      }
    })

    return unsubscribe
  }, [refreshSongs])

  const handleUpload = useCallback(async () => {
    setBusy(true)
    try {
      const filePath = await window.timbrel.pickAudioFile()
      if (!filePath) return
      const result = await window.timbrel.startSeparation({ filePath })
      if (!result.ok) {
        window.alert(`Could not start separation: ${result.error}`)
        return
      }
      if (result.alreadyExists) {
        setSelectedSongId(result.songId)
        return
      }
      setJobs((j) => ({ ...j, [result.songId]: { stage: 'queued', progress: 0 } }))
      await refreshSongs()
    } finally {
      setBusy(false)
    }
  }, [refreshSongs])

  const content = selectedSongId ? (
    <Studio songId={selectedSongId} onBack={() => setSelectedSongId(null)} />
  ) : searchOpen ? (
    <Search
      onBack={() => {
        setSearchOpen(false)
        void refreshSongs()
      }}
      onOpenSong={(songId) => {
        setSearchOpen(false)
        setSelectedSongId(songId)
      }}
    />
  ) : (
    <Library
      songs={songs}
      jobs={jobs}
      busy={busy}
      onUpload={handleUpload}
      onOpenSearch={() => setSearchOpen(true)}
      onOpen={setSelectedSongId}
    />
  )

  return (
    <>
      {content}
      {/* Audio output routing — app-wide launcher + modal (works with no song loaded). */}
      <AudioOutput />
    </>
  )
}

export default App
