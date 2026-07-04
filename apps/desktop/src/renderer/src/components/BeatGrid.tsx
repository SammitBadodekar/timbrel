import { memo, useEffect, useRef } from 'react'

interface BeatGridProps {
  /** Beat onset times in seconds (`features.beatTimes`). */
  beatTimes: number[]
  /** Downbeat (bar-start) times in seconds — a subset of `beatTimes`. */
  downbeatTimes: number[]
  /** Manual grid nudge in seconds (`project.beatGridOffsetSec`). */
  offsetSec: number
  durationSec: number
  /** Pixel size of the lane region the grid spans (all stems stacked). */
  width: number
  height: number
}

/**
 * The beat grid drawn across the stacked stem lanes: faint lines on every beat,
 * brighter lines on downbeats. Auto detection is imperfect, so the whole grid
 * shifts by `offsetSec` (the manual nudge). Redraws only when its inputs change.
 */
function BeatGridBase({
  beatTimes,
  downbeatTimes,
  offsetSec,
  durationSec,
  width,
  height
}: BeatGridProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !height || !durationSec) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const downbeats = new Set(downbeatTimes)
    const toX = (t: number): number => ((t + offsetSec) / durationSec) * width

    for (const t of beatTimes) {
      const x = Math.round(toX(t)) + 0.5
      if (x < 0 || x > width) continue
      const isDownbeat = downbeats.has(t)
      ctx.strokeStyle = isDownbeat ? 'rgba(231,234,238,0.32)' : 'rgba(231,234,238,0.10)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
  }, [beatTimes, downbeatTimes, offsetSec, durationSec, width, height])

  return <canvas ref={canvasRef} className="absolute inset-0" />
}

export default memo(BeatGridBase)
