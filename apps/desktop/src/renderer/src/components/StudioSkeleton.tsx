/**
 * Loading placeholder shown while a song's stems decode + peaks compute. Mirrors
 * the real studio layout (lanes card + bottom dock) with shimmering blocks — each
 * lane gets a waveform-shaped bar silhouette — so the transition into the loaded
 * studio doesn't jump.
 */
const LANES = 6
const BARS = 56

/** Deterministic, waveform-ish bar heights (px) for a lane — no randomness so
 *  it's stable across renders; each lane differs via its index. */
function laneBars(lane: number): number[] {
  return Array.from({ length: BARS }, (_, i) => {
    const n = Math.abs(Math.sin(i * 0.5 + lane * 1.3) * Math.cos(i * 0.19 + lane))
    return Math.round(8 + n * 44)
  })
}

function StudioSkeleton(): React.JSX.Element {
  return (
    <>
      <div className="flex min-h-0 flex-1 px-5 pb-2">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border bg-surface">
          {/* ruler strip */}
          <div className="flex h-[22px] border-b border-border">
            <div className="w-40 shrink-0" />
            <div className="skeleton flex-1 border-l border-border" />
          </div>

          {/* lanes */}
          <div className="flex-1">
            {Array.from({ length: LANES }).map((_, i) => (
              <div
                key={i}
                className="flex h-20 items-stretch border-b border-border/70 last:border-b-0"
              >
                {/* gutter (channel strip) */}
                <div className="flex w-40 shrink-0 flex-col justify-center gap-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full bg-surface-2" />
                    <span className="skeleton h-3 w-16 rounded" />
                    <span className="ml-auto h-5 w-5 rounded-full bg-surface-2" />
                    <span className="h-5 w-5 rounded-full bg-surface-2" />
                  </div>
                  <span className="skeleton h-1 w-full rounded-full" />
                </div>

                {/* waveform area — a shimmering bar silhouette */}
                <div className="skeleton relative flex-1 border-l border-border">
                  <div className="pointer-events-none absolute inset-0 flex items-center gap-[3px] px-3">
                    {laneBars(i).map((h, j) => (
                      <span
                        key={j}
                        className="flex-1 rounded-full bg-black/[0.06]"
                        style={{ height: h }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* dock placeholder */}
      <div className="flex shrink-0 justify-center px-5 pb-5 pt-1">
        <div className="skeleton h-[52px] w-[560px] max-w-full rounded-full" />
      </div>
    </>
  )
}

export default StudioSkeleton
