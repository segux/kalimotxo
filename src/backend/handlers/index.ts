import { getEffectiveLocale, setStoredLocale } from '../config/locale'
import type { SupportedLocale } from '../../common/types/ipc'
import { detectHardware, ensureDirectories } from '../config/paths'
import { addHandler } from '../ipc'
import { checkAll } from '../system/checks'
import { downloadAll, downloadComponent, getDownloadStatus, isSetupComplete } from '../setup/runtime'
import { repairRuntime } from '../setup/repairRuntime'
import {
  ensureD3dmetal,
  installD3dmetalFromCrossOver,
  installD3dmetalFromGptkDmg
} from '../wine/d3dmetalSetup'
import { getSetupWizardState, runSetupWizard, skipSetupWizard } from '../setup/wizard'
import { installSystemDependencies } from '../setup/systemInstaller'
import { loadCatalog, getActiveVersionId } from '../wine/manager/catalog'
import {
  getActiveVersion,
  getWineInstallStatus,
  installWineVersion,
  listInstalled,
  listRepositories,
  refreshWineReleases,
  removeWineVersion,
  setActiveWineVersion
} from '../wine/manager/manager'
import {
  getWineSettings,
  listDetectedWineInstallations,
  resolveBattleNetWineInstallation
} from '../wine/compatibilityLayers'
import { loadGlobalConfig, saveGlobalConfig } from '../config/paths'
import { listBottles } from '../bottle'
import { resetWineInstallationCache } from '../launcher/wineRunner'
import { maintainBattleNetAgent } from '../storeManagers/battlenet/agent'
import {
  cancel,
  checkClient,
  getBattleNetStatus,
  launch,
  launchGame,
  repair,
  repairBottle,
  startInstall,
  uninstall
} from '../storeManagers/battlenet/service'

export function registerAllHandlers(): void {
  ensureDirectories()

  addHandler('getLocale', async () => getEffectiveLocale())

  addHandler('setLocale', async (_e, locale: SupportedLocale) => setStoredLocale(locale))

  addHandler('getSystemStatus', async () => ({
    setup: {
      runtime_ready: isSetupComplete(),
      download_status: getDownloadStatus(),
      checks: checkAll()
    },
    hardware: detectHardware()
  }))

  addHandler('getSetupState', async () => ({
    runtime_ready: isSetupComplete(),
    download_status: getDownloadStatus(),
    checks: checkAll()
  }))

  addHandler('setupDownloadComponent', async (_e, component) =>
    downloadComponent(component)
  )

  addHandler('setupDownloadAll', async () => downloadAll())

  addHandler('setupImportD3dmetalFromCrossOver', async () => {
    const [ok, message] = installD3dmetalFromCrossOver()
    return { success: ok, message }
  })

  addHandler('setupImportD3dmetalFromDmg', async (_e, dmgPath: string) => {
    const [ok, message] = installD3dmetalFromGptkDmg(dmgPath)
    return { success: ok, message }
  })

  addHandler('setupEnsureD3dmetal', async () => {
    const [ok, message] = await ensureD3dmetal()
    return { success: ok, message }
  })

  addHandler('setupRepairRuntime', async () => repairRuntime())

  addHandler('getSetupWizardState', async () => getSetupWizardState())

  addHandler('skipSetupWizard', async () => skipSetupWizard())

  addHandler('setupInstallSystemDeps', async () => installSystemDependencies())

  addHandler('setupRunWizard', async (_e, options?: { installBattleNet?: boolean }) =>
    runSetupWizard(undefined, options ?? { installBattleNet: true })
  )

  addHandler('getBattleNetStatus', async () => getBattleNetStatus())

  addHandler('battleNetInstall', async () => startInstall())

  addHandler('battleNetRepair', async () => repair())

  addHandler('battleNetRepairBottle', async () => repairBottle())

  addHandler('battleNetLaunch', async () => {
    const { play } = await import('../storeManagers/battlenet/service')
    return play()
  })

  addHandler('battleNetLaunchGame', async (_e, gameId: string) => launchGame(gameId))

  addHandler('battleNetUninstall', async () => uninstall())

  addHandler('battleNetCheckClient', async () => checkClient())

  addHandler('battleNetCancel', async () => {
    return cancel()
  })

  addHandler('battleNetClearLoginCache', async () => {
    const r = await maintainBattleNetAgent('Battle.net', { deep: true })
    return {
      success: true,
      message: r.programData
        ? 'Cache and Agent reset automatically'
        : 'No ProgramData cache to clear'
    }
  })

  addHandler('battleNetWakeAgent', async () => {
    await maintainBattleNetAgent('Battle.net', { deep: false, wake: true })
    return { success: true, message: 'Agent ready' }
  })

  addHandler('getWineVersions', async () => ({ versions: loadCatalog() }))

  addHandler('getWineInstalled', async () => ({
    installed: listInstalled(),
    active: getActiveVersionId(),
    activeDetail: getActiveVersion()
  }))

  addHandler('getWineRepositories', async () => ({ repositories: listRepositories() }))

  addHandler('refreshWineCatalog', async () => {
    const versions = await refreshWineReleases()
    return { success: true, versions }
  })

  addHandler('installWineVersion', async (_e, version: string) => installWineVersion(version))

  addHandler('removeWineVersion', async (_e, version: string) => removeWineVersion(version))

  addHandler('setActiveWineVersion', async (_e, version: string) =>
    setActiveWineVersion(version)
  )

  addHandler('getWineInstallStatus', async () => getWineInstallStatus())

  addHandler('listBottles', async () => ({ bottles: listBottles() }))

  addHandler('getDetectedWine', async () => {
    const installations = listDetectedWineInstallations()
    let active: { name: string; type: string } | null = null
    try {
      const a = resolveBattleNetWineInstallation()
      active = { name: a.name, type: a.type }
    } catch {
      /* sin wine */
    }
    return {
      installations: installations.map((i) => ({
        name: i.name,
        type: i.type,
        bin: i.bin
      })),
      active,
      crossoverBottles: [],
      crossoverBottleInfos: [],
      effectiveCrossoverBottle: null,
      recommendedCrossoverBottle: null,
      settings: getWineSettings()
    }
  })

  addHandler('setWineLayer', async (_e, settings) => {
    const cfg = loadGlobalConfig()
    if (settings.wineLayer) cfg.wineLayer = settings.wineLayer
    if (settings.crossoverBottle !== undefined) {
      cfg.crossoverBottle = settings.crossoverBottle
    }
    saveGlobalConfig(cfg)
    resetWineInstallationCache()
    return { success: true }
  })
}
