import { useTranslation } from 'react-i18next'
import { Loader2, Play, Settings2 } from 'lucide-react'
import type { LibraryEntry } from 'common/types/library'
import { Button } from '../ui/button'

/** Stable hue from the game name, so each tile keeps its colour. */
function hueFor(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase()
}

export function GameCard({
  entry,
  busy,
  onPlay,
  onSettings
}: {
  entry: LibraryEntry
  busy: boolean
  onPlay: () => void
  onSettings?: () => void
}) {
  const { t } = useTranslation('stores')
  const hue = hueFor(entry.name)
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] transition hover:border-white/15">
      <div
        className="relative flex aspect-[16/9] items-center justify-center"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 55% 28%), hsl(${(hue + 50) % 360} 60% 14%))`
        }}
      >
        <span className="text-4xl font-bold tracking-tight text-white/85">
          {initials(entry.name)}
        </span>
        <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/70">
          {entry.source === 'battlenet' ? 'Battle.net' : t(`library.backendShort.${entry.backend}`, entry.backend)}
        </span>
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            className="absolute right-2 top-2 rounded-md bg-black/50 p-1.5 text-white/60 opacity-0 transition hover:text-white group-hover:opacity-100 focus:opacity-100"
            aria-label={t('library.settings')}
          >
            <Settings2 size={15} />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-white/90" title={entry.name}>
            {entry.name}
          </p>
          <p className="text-xs text-white/40">
            {entry.running
              ? t('library.running')
              : entry.last_played
                ? t('library.lastPlayed', {
                    date: new Date(entry.last_played).toLocaleDateString()
                  })
                : t('library.neverPlayed')}
          </p>
        </div>
        <Button onClick={onPlay} disabled={busy || entry.running} className="shrink-0 gap-1.5 px-3">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {t('library.play')}
        </Button>
      </div>
    </div>
  )
}
