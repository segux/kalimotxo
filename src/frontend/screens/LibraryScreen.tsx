import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Gamepad2, Plus } from 'lucide-react'
import type { LibraryEntry, LibraryGame } from 'common/types/library'
import { getAvailableStores } from '../config/stores'
import { StoreLogo } from '../components/stores/StoreLogo'
import { getStoreBannerUrl } from '../components/stores/StoreLogo'
import { Button } from '../components/ui/button'
import { GameCard } from '../components/library/GameCard'
import { AddGameDialog } from '../components/library/AddGameDialog'
import { GameSettingsDialog } from '../components/library/GameSettingsDialog'

export default function LibraryScreen() {
  const { t } = useTranslation('stores')
  const stores = getAvailableStores()
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<LibraryGame | null>(null)
  const [launching, setLaunching] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = useCallback(async () => {
    setEntries(await window.api.libraryList())
  }, [])

  useEffect(() => {
    void refresh()
    const off1 = window.api.on('libraryChanged', () => void refresh())
    const off2 = window.api.on('gameLaunchError', ({ gameName, message: text }) =>
      setMessage({ ok: false, text: `${gameName}: ${text}` })
    )
    return () => {
      off1()
      off2()
    }
  }, [refresh])

  const play = async (entry: LibraryEntry): Promise<void> => {
    setLaunching(entry.id)
    setMessage(null)
    try {
      const r =
        entry.source === 'battlenet'
          ? await window.api.battleNetLaunchGame(entry.id)
          : await window.api.libraryLaunchGame(entry.id)
      if (!r.success) setMessage({ ok: false, text: r.message })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setLaunching(null)
      void refresh()
    }
  }

  return (
    <div className="px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('library.title')}</h1>
          <p className="mt-1 text-sm text-white/50">{t('library.subtitle')}</p>
        </div>
        <Button className="gap-2" onClick={() => setAdding(true)}>
          <Plus size={16} />
          {t('library.addGame')}
        </Button>
      </div>

      {message && (
        <div
          className={
            message.ok
              ? 'mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100'
              : 'mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100'
          }
        >
          {message.text}
        </div>
      )}

      {entries && entries.length === 0 && (
        <div className="mt-12 rounded-xl border border-dashed border-white/10 py-14 text-center text-white/45">
          <Gamepad2 className="mx-auto mb-4 opacity-30" size={44} />
          <p>{t('library.noGames')}</p>
          <Button variant="outline" className="mt-5 gap-2" onClick={() => setAdding(true)}>
            <Plus size={16} />
            {t('library.addGame')}
          </Button>
        </div>
      )}

      {entries && entries.length > 0 && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map((entry) => (
            <GameCard
              key={`${entry.source}:${entry.id}`}
              entry={entry}
              busy={launching === entry.id}
              onPlay={() => void play(entry)}
              onSettings={entry.game ? () => setEditing(entry.game!) : undefined}
            />
          ))}
        </div>
      )}

      {stores.length > 0 && (
        <>
          <h2 className="mt-12 text-sm font-medium uppercase tracking-wider text-white/40">
            {t('library.platforms')}
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stores.map((store) => (
              <Link
                key={store.id}
                to={store.route}
                className="group relative overflow-hidden rounded-xl border border-white/[0.08] transition hover:border-white/15"
              >
                <img
                  src={getStoreBannerUrl(store.id)}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-60"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
                <div className="relative flex items-center gap-4 p-4">
                  <div className="rounded-lg bg-black/50 p-2.5 backdrop-blur-sm">
                    <StoreLogo storeId={store.id} size="lg" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{store.name}</h3>
                    <p className="text-xs text-white/55">{t('library.openManager')}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {adding && (
        <AddGameDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setMessage(null)
            void refresh()
          }}
        />
      )}
      {editing && (
        <GameSettingsDialog
          game={editing}
          onClose={() => setEditing(null)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  )
}
