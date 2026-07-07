import { useState } from 'react'
import { gradientFor, monogram } from '../lib/art'

interface SongArtProps {
  id: string
  title: string
  /** YouTube thumbnail URL; falls back to a pastel monogram when absent/broken. */
  thumbnailUrl?: string | null
  /** Sizing + rounding for the tile (the art fills it). */
  className?: string
  /** Monogram font size for the fallback. */
  monoClass?: string
}

/**
 * A song's cover art: the real YouTube thumbnail when we have one, otherwise a
 * deterministic pastel-gradient monogram. Hotlinks the thumbnail (allowed by the
 * CSP); on a load error (offline, or a since-removed video) it drops back to the
 * monogram so the UI never shows a broken image.
 */
function SongArt({
  id,
  title,
  thumbnailUrl,
  className = '',
  monoClass = 'text-base'
}: SongArtProps): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  const showImg = !!thumbnailUrl && !broken
  return (
    <div
      className={`overflow-hidden bg-surface-2 ${className}`}
      style={showImg ? undefined : { background: gradientFor(id) }}
      aria-hidden
    >
      {showImg ? (
        <img
          src={thumbnailUrl!}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className={`grid h-full w-full place-items-center font-medium text-text/45 ${monoClass}`}
        >
          {monogram(title)}
        </div>
      )}
    </div>
  )
}

export default SongArt
