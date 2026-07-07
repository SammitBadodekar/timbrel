import { useEffect, useState } from 'react'
import type { SetupState } from '@shared/ipc'

/**
 * First-run gate: on a fresh install everything Timbrel shells out to — the
 * separation engine (~200 MB), yt-dlp, ffmpeg/ffprobe — is downloaded before
 * the app is usable, so the whole app renders behind this screen until the
 * install reaches `ready`. Shows per-item download/unpack progress and a retry
 * on failure. Dev builds and already-installed launches report `ready`
 * immediately — the gate never flashes.
 */
function SetupGate({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const [setup, setSetup] = useState<SetupState | null>(null)

  useEffect(() => {
    // Subscribe before the initial query so no transition is missed; the query
    // fills in the current state unless a pushed event already did.
    const off = window.timbrel.onSetupState(setSetup)
    void window.timbrel.getSetupState().then((state) => setSetup((cur) => cur ?? state))
    return off
  }, [])

  if (setup === null) return null // one frame while the initial state loads
  if (setup.status === 'ready') return <>{children}</>

  return (
    <div className="flex h-full items-center justify-center px-6">
      <main className="animate-pop w-[460px] max-w-full rounded-3xl border border-border bg-surface p-8 shadow-card">
        <StemDots paused={setup.status === 'error'} />
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Setting up your studio</h1>

        {setup.status === 'error' ? (
          <>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Timbrel couldn&apos;t download what it needs. Check your internet connection and try
              again — it resumes from where it stopped.
            </p>
            <p className="mt-4 rounded-xl bg-wash-peach/50 px-3.5 py-2.5 text-xs leading-relaxed text-text/80">
              {setup.message}
            </p>
            <button
              type="button"
              onClick={() => void window.timbrel.retrySetup()}
              className="mt-6 w-full rounded-full bg-charcoal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-hover"
            >
              Try again
            </button>
          </>
        ) : (
          <InstallProgress setup={setup} />
        )}
      </main>
    </div>
  )
}

function InstallProgress({
  setup
}: {
  setup: Extract<SetupState, { status: 'installing' }>
}): React.JSX.Element {
  const downloading = setup.stage === 'downloading'
  const pct = Math.min(100, Math.floor(setup.progress * 100))
  return (
    <>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Timbrel is downloading its audio engine and tools — the parts that fetch songs and split
        them into stems. This happens once; sit tight for a few minutes.
      </p>
      <div className="progress-shimmer mt-7 h-2 overflow-hidden rounded-full bg-black/[0.07]">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2.5 flex items-baseline justify-between text-xs text-fog">
        <span>
          {downloading ? `Downloading ${setup.item}…` : `Unpacking ${setup.item}…`}
          {setup.steps > 1 && ` (${setup.step} of ${setup.steps})`}
        </span>
        {downloading && (
          <span className="tabular-nums">
            {pct}% of ~{setup.approxMB} MB
          </span>
        )}
      </div>
    </>
  )
}

/** The five stem hues as a playful brand mark; they pulse while installing. */
function StemDots({ paused }: { paused: boolean }): React.JSX.Element {
  const dots = [
    'bg-stem-vocals',
    'bg-stem-drums',
    'bg-stem-bass',
    'bg-stem-guitar',
    'bg-stem-piano'
  ]
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {dots.map((color, i) => (
        <span
          key={color}
          className={`h-3 w-3 rounded-full ${color} ${paused ? 'opacity-40' : 'animate-pulse'}`}
          style={paused ? undefined : { animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  )
}

export default SetupGate
