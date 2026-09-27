import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Loader2, PackagePlus, FileCode2 } from 'lucide-react'
import type {
  ExeCandidate,
  LibraryGraphicsBackend,
  LibraryInstallProgress
} from 'common/types/library'
import { Button } from '../ui/button'
import { Modal } from '../ui/modal'
import { BackendSelect, TextField } from './BackendSelect'

type Step = 'choose' | 'installing' | 'form'

function baseName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.exe$/i, '')
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function AddGameDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { t } = useTranslation('stores')
  const [step, setStep] = useState<Step>('choose')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<LibraryInstallProgress | null>(null)
  const [candidates, setCandidates] = useState<ExeCandidate[]>([])
  const [exe, setExe] = useState('')
  const [name, setName] = useState('')
  const [backend, setBackend] = useState<LibraryGraphicsBackend | 'auto'>('auto')
  const [saving, setSaving] = useState(false)

  useEffect(() => window.api.on('libraryInstallProgress', setProgress), [])

  const pickExe = async (): Promise<void> => {
    const path = await window.api.libraryPickFile('exe')
    if (!path) return
    setExe(path)
    if (!name.trim()) setName(baseName(path))
    setStep('form')
  }

  const runInstaller = async (): Promise<void> => {
    const path = await window.api.libraryPickFile('installer')
    if (!path) return
    setError(null)
    setProgress(null)
    setStep('installing')
    const r = await window.api.libraryInstall(path)
    if (!r.success) {
      setError(r.cancelled ? t('library.install.cancelled') : r.message)
      setStep('choose')
      return
    }
    setCandidates(r.candidates)
    // Never preselect an exe that is not a confident suggestion.
    setExe(r.candidates.find((c) => c.suggested)?.path ?? '')
    setName(r.suggestedName)
    if (!r.candidates.length) setError(t('library.add.noExecutables'))
    setStep('form')
  }

  const save = async (): Promise<void> => {
    if (!exe) return
    setSaving(true)
    setError(null)
    const r = await window.api.libraryAddGame({
      name,
      exe,
      backend: backend === 'auto' ? undefined : backend
    })
    setSaving(false)
    if (!r.success) {
      setError(r.message)
      return
    }
    onAdded()
    onClose()
  }

  const installing = step === 'installing'

  return (
    <Modal title={t('library.add.title')} onClose={onClose} dismissable={!installing}>
      {error && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {error}
        </div>
      )}

      {step === 'choose' && (
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => void runInstaller()}
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
          >
            <PackagePlus className="mt-0.5 shrink-0 text-kal-accent" size={22} />
            <span>
              <span className="block font-medium text-white">{t('library.add.fromInstaller')}</span>
              <span className="text-sm text-white/50">{t('library.add.fromInstallerHint')}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => void pickExe()}
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
          >
            <FileCode2 className="mt-0.5 shrink-0 text-kal-accent" size={22} />
            <span>
              <span className="block font-medium text-white">{t('library.add.existing')}</span>
              <span className="text-sm text-white/50">{t('library.add.existingHint')}</span>
            </span>
          </button>
          <p className="text-xs text-white/35">{t('library.add.bottleNote')}</p>
        </div>
      )}

      {installing && (
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 animate-spin text-kal-accent" size={32} />
          <p className="font-medium text-white">
            {t(`library.install.phase.${progress?.phase ?? 'bottle'}`)}
          </p>
          <p className="mt-2 text-sm text-white/50">{t('library.install.hint')}</p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => void window.api.libraryCancelInstall()}
          >
            {t('library.install.cancel')}
          </Button>
        </div>
      )}

      {step === 'form' && (
        <div className="space-y-4">
          {candidates.length > 0 && (
            <div>
              <p className="mb-2 text-sm text-white/60">{t('library.add.chooseExe')}</p>
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {candidates.map((c) => (
                  <li key={c.path}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5">
                      <input
                        type="radio"
                        name="exe"
                        checked={exe === c.path}
                        onChange={() => setExe(c.path)}
                      />
                      <span className="min-w-0 flex-1 truncate text-white/80" title={c.label}>
                        {c.label}
                      </span>
                      <span className="shrink-0 text-xs text-white/35">{formatSize(c.size)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-white/40" title={exe}>
              {exe || t('library.add.noExeSelected')}
            </p>
            <Button variant="outline" className="shrink-0 gap-1.5 px-3" onClick={() => void pickExe()}>
              <FolderOpen size={15} />
              {t('library.add.browse')}
            </Button>
          </div>

          <TextField label={t('library.name')} value={name} onChange={setName} />
          <BackendSelect value={backend} onChange={setBackend} allowAuto />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              {t('library.cancel')}
            </Button>
            <Button onClick={() => void save()} disabled={!exe || saving}>
              {t('library.add.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
