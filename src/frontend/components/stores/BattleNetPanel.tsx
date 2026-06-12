import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Play } from 'lucide-react'
import type { BattleNetStatus, InstallProgress } from 'common/types/battlenet'
import { Button } from '../ui/button'
import { LoadingSplash } from '../brand/LoadingSplash'
import { StoreLogo } from './StoreLogo'

type UiMode = 'idle' | 'working' | 'success'

function deriveMode(s: BattleNetStatus, busy: boolean): UiMode {
  if (busy || s.install_running || s.repair_running) return 'working'
  if (s.can_launch) return 'success'
  return 'idle'
}

function headline(s: BattleNetStatus, t: (k: string) => string): string {
  if (s.can_launch) return t('battlenet.heroReady')
  if (s.awaiting_blizzard_wizard) return t('battlenet.heroWizard')
  if (s.client_exe) return t('battlenet.heroAlmost')
  return t('battlenet.heroStart')
}

function subline(s: BattleNetStatus, t: (k: string) => string): string {
  if (s.can_launch) return t('battlenet.heroReadySub')
  if (s.awaiting_blizzard_wizard) return t('battlenet.heroWizardSub')
  if (s.client_exe) return t('battlenet.heroAlmostSub')
  return t('battlenet.heroStartSub')
}

function primaryLabel(s: BattleNetStatus, t: (k: string) => string): string {
  if (s.can_launch) return t('battlenet.openBattleNet')
  if (s.awaiting_blizzard_wizard || s.client_exe) return t('battlenet.continueSetup')
  return t('battlenet.getStarted')
}

export function BattleNetPanel() {
  const { t } = useTranslation('stores')
  const [status, setStatus] = useState<BattleNetStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [lastSuccess, setLastSuccess] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.api.getBattleNetStatus())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const off1 = window.api.on('battleNetStatus', setStatus)
    const off2 = window.api.on('battleNetInstallProgress', setProgress)
    const off3 = window.api.on('battleNetInstallFinished', () => {
      void refresh()
    })
    const off4 = window.api.on('gameLaunchError', ({ gameName, message }) => {
      setError(`${gameName}: ${message}`)
    })
    return () => {
      off1()
      off2()
      off3()
      off4()
    }
  }, [refresh])

  const kickAndRetry = async (): Promise<{ success: boolean; message: string }> => {
    return window.api.battleNetLaunch()
  }

  const runPrimary = async () => {
    if (busy || !status) return
    setBusy(true)
    setError(null)
    setLastSuccess(null)
  setProgress(null)
    try {
      const r = await window.api.battleNetLaunch()
      if (!r.success) {
        setError(r.message)
      } else {
        setLastSuccess(r.message)
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const runAdvanced = async (fn: () => Promise<{ success: boolean; message: string }>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      if (!r.success) setError(r.message)
      else setLastSuccess(r.message)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    if (error) {
      return (
        <div className="mx-auto max-w-xl mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-left text-sm text-red-100">
          {error}
        </div>
      )
    }
    return <LoadingSplash statusKey="statusBattleNet" className="min-h-[360px]" />
  }

  const s = status
  const mode = deriveMode(s, busy)
  const working = mode === 'working'
  const pct = progress?.percent ?? (working ? 12 : 0)
  const progressLabel = progress?.message || t('battlenet.working')

  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl border border-white/[0.08] bg-kal-panel/90 p-8 text-center shadow-xl backdrop-blur">
        <div className="mx-auto mb-4 flex justify-center">
          <StoreLogo storeId="battlenet" size="lg" />
        </div>

        <h2 className="text-2xl font-semibold text-white">{headline(s, t)}</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/55">{subline(s, t)}</p>

        {working && (
          <div className="mt-6 text-left">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#00aeff] transition-all duration-500"
                style={{ width: `${Math.max(8, pct)}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-white/60">{progressLabel}</p>
            <p className="mt-1 text-xs text-white/35">{t('battlenet.workingHint')}</p>
            <p className="mt-2 text-xs text-amber-200/80">{t('battlenet.stuckAt45Hint')}</p>
            <Button
              variant="outline"
              disabled={busy}
              className="mt-4 w-full border-white/20 text-white/80"
              onClick={() =>
                void runAdvanced(async () => {
                  await window.api.battleNetCancel()
                  return kickAndRetry()
                })
              }
            >
              {t('battlenet.cancelAndRetry')}
            </Button>
          </div>
        )}

        {!working && (
          <Button
            disabled={busy}
            onClick={() => void runPrimary()}
            className="mt-8 h-12 w-full max-w-sm gap-2 bg-[#00aeff] text-base font-semibold hover:bg-[#33bdfd]"
          >
            <Play size={20} fill="currentColor" />
            {primaryLabel(s, t)}
          </Button>
        )}

        {lastSuccess && !error && !working && (
          <p className="mt-4 text-sm text-emerald-200/90">{lastSuccess}</p>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-left text-sm text-red-100">
            {error}
          </div>
        )}

        {s.installed_games.length > 0 && (
          <div className="mt-8 border-t border-white/[0.06] pt-6 text-left">
            <p className="text-xs font-medium uppercase tracking-wider text-white/40">
              {t('battlenet.yourGames')}
            </p>
            <ul className="mt-3 space-y-2">
              {s.installed_games.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-4 py-3"
                >
                  <span className="font-medium text-white/90">{g.name}</span>
                  <Button
                    disabled={busy || working}
                    onClick={() =>
                      void runAdvanced(() => window.api.battleNetLaunchGame(g.id))
                    }
                    className="bg-[#00aeff] hover:bg-[#33bdfd]"
                  >
                    {t('battlenet.playGame')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex w-full items-center justify-center gap-1 text-xs text-white/35 hover:text-white/55"
        >
          {t('battlenet.advanced')}
          <ChevronDown
            size={14}
            className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {advancedOpen && (
          <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/20 p-4 text-left text-xs text-white/45">
            <p className="mb-3 text-white/55">{t('battlenet.advancedHint')}</p>
            <div className="flex flex-wrap gap-2">
              {s.can_repair && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void runAdvanced(() => window.api.battleNetRepair())}
                >
                  {t('battlenet.repair')}
                </Button>
              )}
              {s.can_repair && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void runAdvanced(() => window.api.battleNetRepairBottle())}
                  title={t('battlenet.repairBottleHint')}
                >
                  {t('battlenet.repairBottle')}
                </Button>
              )}
              {s.can_uninstall && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void runAdvanced(() => window.api.battleNetUninstall())}
                  className="text-red-300"
                >
                  {t('battlenet.uninstall')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
