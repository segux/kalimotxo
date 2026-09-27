import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'

type WineReleaseRow = {
  version: string
  type: string
  date: string
  is_installed: boolean
  install_dir?: string
}

export default function WineManagerScreen() {
  const { t } = useTranslation('settings')
  const [installed, setInstalled] = useState<WineReleaseRow[]>([])
  const [catalog, setCatalog] = useState<WineReleaseRow[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [bottles, setBottles] = useState<{ name: string }[]>([])
  const [installStatus, setInstallStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const w = await window.api.getWineInstalled()
    setInstalled((w.installed as WineReleaseRow[]) ?? [])
    setActive(w.active)
    const b = await window.api.listBottles()
    setBottles((b.bottles as { name: string }[]) ?? [])
    const v = await window.api.getWineVersions()
    setCatalog((v.versions as WineReleaseRow[]) ?? [])
    const st = await window.api.getWineInstallStatus()
    if (st.running) {
      setInstallStatus(`${st.percent}% — ${st.message}`)
    } else if (st.message && st.status !== 'idle') {
      setInstallStatus(st.message)
    }
  }, [])

  useEffect(() => {
    refresh()
    const offProgress = window.api.on('wineInstallProgress', (st) => {
      setInstallStatus(`${st.percent}% — ${st.message}`)
      if (!st.running) refresh()
    })
    const offDone = window.api.on('wineInstallFinished', () => {
      setBusy(false)
      refresh()
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [refresh])

  const onRefreshCatalog = async () => {
    setBusy(true)
    setInstallStatus(t('wine.refreshing'))
    await window.api.refreshWineCatalog()
    setBusy(false)
    await refresh()
    setInstallStatus('')
  }

  const onInstallHeroicDefault = async () => {
    setBusy(true)
    setInstallStatus(t('wine.installingDefault'))
    await window.api.refreshWineCatalog()
    const r = await window.api.installWineVersion('Wine-BattleNet-latest')
    if (!r.success) {
      const r2 = await window.api.installWineVersion('Wine-Staging-macOS-latest')
      setInstallStatus(r2.message)
      if (!r2.success) setBusy(false)
    } else {
      setInstallStatus(r.message)
    }
  }

  const catalogSlice = catalog.filter(
    (r) => r.version.endsWith('-latest') || r.is_installed
  )

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardTitle>{t('wine.kalimotxoWineTitle')}</CardTitle>
        <p className="mt-1 text-sm text-white/55">{t('wine.kalimotxoWineHint')}</p>
        <p className="mt-2 text-sm text-white/60">
          {t('wine.active', { name: active ?? t('wine.activeNone') })}
        </p>
      </Card>

      <Card>
        <CardTitle>{t('wine.catalogTitle')}</CardTitle>
        {installStatus && (
          <p className="mt-2 text-xs text-kal-accent">{installStatus}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" className="px-3 py-1.5 text-xs" disabled={busy} onClick={onRefreshCatalog}>
            {t('wine.refreshCatalog')}
          </Button>
          <Button type="button" className="px-3 py-1.5 text-xs" disabled={busy} onClick={onInstallHeroicDefault}>
            {t('wine.installRecommended')}
          </Button>
        </div>
        <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto text-sm">
          {catalogSlice.length === 0 && (
            <li className="text-white/50">{t('wine.noVersions')}</li>
          )}
          {catalogSlice.map((row) => (
            <li
              key={row.version}
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-white/5 px-2 py-2"
            >
              <div>
                <div className="font-medium text-white/90">{row.version}</div>
                <div className="text-xs text-white/45">
                  {row.type}
                  {row.is_installed ? ` · ${t('wine.installed')}` : ''}
                  {active === row.version ? ` · ${t('wine.inUse')}` : ''}
                </div>
              </div>
              <div className="flex gap-1">
                {!row.is_installed && (
                  <Button
                    type="button"
                    className="px-2 py-1 text-xs"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      await window.api.installWineVersion(row.version)
                    }}
                  >
                    {t('wine.install')}
                  </Button>
                )}
                {row.is_installed && active !== row.version && (
                  <Button
                    type="button"
                    className="px-2 py-1 text-xs"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      await window.api.setActiveWineVersion(row.version)
                      refresh()
                    }}
                  >
                    {t('wine.activate')}
                  </Button>
                )}
                {row.is_installed && row.version !== 'Wine-legacy' && (
                  <Button
                    type="button"
                    className="px-2 py-1 text-xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      await window.api.removeWineVersion(row.version)
                      refresh()
                    }}
                  >
                    {t('wine.remove')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>{t('wine.bottlesTitle')}</CardTitle>
        <p className="mt-1 text-xs text-white/45">{t('wine.kalimotxoBottlesHint')}</p>
        <ul className="mt-3 space-y-1 text-sm">
          {bottles.length === 0 && <li className="text-white/50">{t('wine.noKalimotxoBottles')}</li>}
          {bottles.map((b) => (
            <li key={b.name} className="rounded bg-white/5 px-2 py-1">
              {b.name}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
