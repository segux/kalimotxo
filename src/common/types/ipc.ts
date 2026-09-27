import type { BattleNetStatus, InstallProgress, OpResult } from './battlenet'
import type {
  AddLibraryGameInput,
  LibraryEntry,
  LibraryGame,
  LibraryInstallProgress,
  LibraryInstallResult,
  UpdateLibraryGameInput
} from './library'

export interface SystemChecks {
  rosetta: { installed: boolean; install_hint?: string }
  gstreamer: { installed: boolean; install_hint?: string }
  cabextract: { installed: boolean; install_hint?: string; path?: string | null }
  homebrew: { installed: boolean }
  xcode_clt: { installed: boolean }
}

export interface SetupState {
  runtime_ready: boolean
  download_status: Record<string, boolean>
  checks: SystemChecks
}

export interface SetupWizardState {
  system_ready: boolean
  runtime_ready: boolean
  wizard_complete: boolean
  wizard_skipped: boolean
  checks: SystemChecks
  download_status: Record<string, boolean>
}

export type SupportedLocale = 'es' | 'en' | 'fr' | 'it' | 'pt' | 'de'

export interface AsyncIPCFunctions {
  getLocale: () => Promise<SupportedLocale>
  setLocale: (locale: SupportedLocale) => Promise<SupportedLocale>
  getSystemStatus: () => Promise<{ setup: SetupState; hardware: Record<string, unknown> }>
  getSetupState: () => Promise<SetupState>
  setupDownloadComponent: (component: string) => Promise<OpResult>
  setupDownloadAll: () => Promise<OpResult>
  getSetupWizardState: () => Promise<SetupWizardState>
  skipSetupWizard: () => Promise<OpResult>
  setupInstallSystemDeps: () => Promise<OpResult>
  setupRunWizard: (options?: { installBattleNet?: boolean }) => Promise<OpResult>
  getBattleNetStatus: () => Promise<BattleNetStatus>
  battleNetInstall: () => Promise<OpResult>
  battleNetRepair: () => Promise<OpResult>
  battleNetRepairBottle: () => Promise<OpResult>
  battleNetLaunch: () => Promise<OpResult>
  battleNetLaunchViaCrossOver: () => Promise<OpResult>
  battleNetUninstall: () => Promise<OpResult>
  battleNetCheckClient: () => Promise<OpResult>
  battleNetCancel: () => Promise<OpResult>
  battleNetClearLoginCache: () => Promise<OpResult>
  battleNetWakeAgent: () => Promise<OpResult>
  battleNetLaunchGame: (gameId: string) => Promise<OpResult>
  setupImportD3dmetalFromDmg: (dmgPath: string) => Promise<OpResult>
  setupEnsureD3dmetal: () => Promise<OpResult>
  setupRepairRuntime: () => Promise<OpResult>
  getWineVersions: () => Promise<{ versions: unknown[] }>
  getWineInstalled: () => Promise<{
    installed: unknown[]
    active: string | null
    activeDetail: {
      version: string
      type: string
      install_dir: string
      wine64: string | null
    } | null
  }>
  getWineRepositories: () => Promise<{
    repositories: { id: string; name: string; typeLabel: string }[]
  }>
  refreshWineCatalog: () => Promise<{ success: boolean; versions: unknown[] }>
  installWineVersion: (version: string) => Promise<{ success: boolean; message: string }>
  removeWineVersion: (version: string) => Promise<{ success: boolean; message: string }>
  setActiveWineVersion: (version: string) => Promise<{ success: boolean; message: string }>
  getWineInstallStatus: () => Promise<{
    running: boolean
    version: string
    status: string
    percent: number
    message: string
  }>
  listBottles: () => Promise<{ bottles: unknown[] }>
  getDetectedWine: () => Promise<{
    installations: { name: string; type: string; bin: string }[]
    active: { name: string; type: string } | null
  }>
  libraryList: () => Promise<LibraryEntry[]>
  libraryPickFile: (kind: 'installer' | 'exe') => Promise<string | null>
  libraryInstall: (installerPath: string) => Promise<LibraryInstallResult>
  libraryCancelInstall: () => Promise<OpResult>
  libraryAddGame: (input: AddLibraryGameInput) => Promise<OpResult & { game?: LibraryGame }>
  libraryUpdateGame: (id: string, patch: UpdateLibraryGameInput) => Promise<OpResult>
  libraryRemoveGame: (id: string) => Promise<OpResult>
  libraryLaunchGame: (id: string) => Promise<OpResult>
  libraryShowInFinder: (id: string) => Promise<OpResult>
}

export interface FrontendMessages {
  battleNetStatus: (status: BattleNetStatus) => void
  battleNetInstallProgress: (progress: InstallProgress) => void
  battleNetInstallFinished: (result: OpResult) => void
  setupProgress: (payload: { component: string; percent: number; message: string }) => void
  wineInstallProgress: (status: {
    running: boolean
    version: string
    status: string
    percent: number
    message: string
  }) => void
  wineInstallFinished: (result: OpResult) => void
  gameLaunchError: (payload: { gameId: string; gameName: string; message: string }) => void
  libraryInstallProgress: (progress: LibraryInstallProgress) => void
  libraryChanged: () => void
}
