import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Trash2 } from 'lucide-react'
import type { LibraryGame, LibraryGraphicsBackend } from 'common/types/library'
import { Button } from '../ui/button'
import { Modal } from '../ui/modal'
import { BackendSelect, TextField } from './BackendSelect'

export function GameSettingsDialog({
  game,
  onClose,
  onChanged
}: {
  game: LibraryGame
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation('stores')
  const [name, setName] = useState(game.name)
  const [backend, setBackend] = useState<LibraryGraphicsBackend>(game.backend)
  const [args, setArgs] = useState(game.args.join(' '))
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    const r = await window.api.libraryUpdateGame(game.id, {
      name,
      backend,
      args: args.split(/\s+/).filter(Boolean)
    })
    if (!r.success) {
      setError(r.message)
      return
    }
    onChanged()
    onClose()
  }

  const remove = async (): Promise<void> => {
    const r = await window.api.libraryRemoveGame(game.id)
    if (!r.success) {
      setError(r.message)
      return
    }
    onChanged()
    onClose()
  }

  return (
    <Modal title={t('library.settingsTitle', { name: game.name })} onClose={onClose}>
      {error && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <TextField label={t('library.name')} value={name} onChange={setName} />
        <BackendSelect
          value={backend}
          onChange={(v) => setBackend(v === 'auto' ? game.backend : v)}
        />
        <p className="-mt-2 text-xs text-white/35">{t('library.graphicsHint')}</p>
        <TextField
          label={t('library.args')}
          value={args}
          onChange={setArgs}
          placeholder="-dx11 -windowed"
        />
        <div className="rounded-lg bg-black/30 px-3 py-2 text-xs text-white/40">
          <p className="truncate" title={game.exe}>
            {game.exe}
          </p>
          <p className="mt-1">{t('library.bottle', { bottle: game.bottle })}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="gap-1.5 px-3"
              onClick={() => void window.api.libraryShowInFinder(game.id)}
            >
              <FolderOpen size={15} />
              {t('library.showInFinder')}
            </Button>
            {confirmRemove ? (
              <Button
                className="gap-1.5 bg-red-600 px-3 hover:bg-red-500"
                onClick={() => void remove()}
              >
                <Trash2 size={15} />
                {t('library.removeConfirm')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="gap-1.5 px-3 text-red-300"
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 size={15} />
                {t('library.remove')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('library.cancel')}
            </Button>
            <Button onClick={() => void save()}>{t('library.save')}</Button>
          </div>
        </div>
        {confirmRemove && <p className="text-xs text-white/40">{t('library.removeHint')}</p>}
      </div>
    </Modal>
  )
}
