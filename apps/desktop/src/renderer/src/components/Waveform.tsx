import { memo, useEffect, useRef } from 'react'

interface WaveformProps {
  /** Per-bucket peak amplitude, 0..1 (from `peaks.json`). */
  peaks: number[]
  color: string
  dimmed: boolean
}

/**
 * A single stem's waveform, drawn imperatively on a canvas from cached peaks.
 * Self-measuring (ResizeObserver) so it fills its lane at any width; memoised so
 * the studio's per-frame playhead re-render never redraws it.
 */
function WaveformBase({ peaks, color, dimmed }: WaveformProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = canvas?.parentElement
    if (!canvas || !wrap) return

    const draw = (): void => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (!w || !h) return
      const dpr = window.devicePixelRatio || 1
      // Assigning width/height clears + reallocates the backing store even when
      // the value is unchanged — skip it (clearRect below wipes the pixels).
      const bw = Math.round(w * dpr)
      const bh = Math.round(h * dpr)
      if (canvas.width !== bw) canvas.width = bw
      if (canvas.height !== bh) canvas.height = bh
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const n = peaks.length
      if (!n) return
      const mid = h / 2
      const half = mid - 2
      ctx.fillStyle = color
      for (let x = 0; x < w; x++) {
        const i0 = Math.floor((x / w) * n)
        const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * n))
        let p = 0
        for (let i = i0; i < i1 && i < n; i++) {
          const v = peaks[i]
          if (v !== undefined && v > p) p = v
        }
        const amp = Math.max(p * half, 0.5)
        ctx.fillRect(x, mid - amp, 1, amp * 2)
      }
    }

    draw()
    // Resize callbacks outpace frames during a window-edge drag; coalesce all
    // six lanes' redraws to at most one per animation frame each.
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        draw()
      })
    })
    ro.observe(wrap)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [peaks, color])

  return (
    <div className="absolute inset-0 transition-opacity" style={{ opacity: dimmed ? 0.3 : 1 }}>
      <canvas ref={canvasRef} />
    </div>
  )
}

export default memo(WaveformBase)
