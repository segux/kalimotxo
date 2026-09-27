import { spawn, type ChildProcess } from 'child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join, relative, sep } from 'path'

import { getBottlePath, listBottles } from '../bottle'
import { BOTTLES_DIR, LOGS_DIR } from '../config/paths'
import { sendFrontendMessage } from '../ipc'
import { getActiveWineInstallation, runExe } from '../launcher/wineRunner'
import { logInfo } from '../logger'
import { BATTLENET_BOTTLE } from '../storeManagers/battlenet/constants'
import { listInstalledBlizzardGames } from '../storeManagers/battlenet/games'
import { killWineServersForBottle } from '../wine/wineServerKill'
import {
  ensureBattleNetWineRuntimeLibs,
  purgeBrokenWinetempSymlinks
} from '../wine/wineRuntimeLibs'
import type {
  AddLibraryGameInput,
  LibraryEntry,
  LibraryGame,
  LibraryInstallProgress,
  LibraryInstallResult,
  UpdateLibraryGameInput
} from '../../common/types/library'
import type { OpResult } from '../../common/types/battlenet'
import { ensureGamesBottle, GAMES_BOTTLE, isGamesBottleReady, isolateUserFolders } from './bottle'
import {
  detectGraphicsBackend,
  nameFromExe,
  nameFromInstaller,
  rankExeCandidates,
  snapshotExes
} from './exeScan'
import { buildInstallerEnv, buildLibraryGameEnv } from './gameEnv'
import {
  addLibraryGameRecord,
  getLibraryGame,
  loadLibrary,
  removeLibraryGameRecord,
  updateLibraryGameRecord
} from './store'
import { resolveWineserver } from '../wine/wineserverPath'

const INSTALL_LOG = join(LOGS_DIR, 'library-install.log')

let installRunning = false
let installCancelled = false
let installWaiter: ChildProcess | null = null
const running = new Map<string, ChildProcess>()

function installLog(m: string): void {
  try {
    appendFileSync(INSTALL_LOG, m + '\n')
  } catch {
    /* ignore */
  }
}

function setInstallProgress(phase: LibraryInstallProgress['phase'], message: string): void {
  installLog(`[${phase}] ${message}`)
  sendFrontendMessage('libraryInstallProgress', { phase, message })
}

function notifyChanged(): void {
  sendFrontendMessage('libraryChanged')
}

/** Bottle whose drive_c contains `exe`, or the shared Games bottle. */
export function bottleForExe(exe: string): string {
  const rel = relative(BOTTLES_DIR, exe)
  if (!rel.startsWith('..') && !rel.startsWith(sep)) {
    const [bottle, driveC] = rel.split(sep)
    if (bottle && driveC === 'drive_c' && listBottles().some((b) => b.name === bottle)) {
      return bottle
    }
  }
  return GAMES_BOTTLE
}

/** Where installers are copied inside the bottle while they run. */
const STAGING_DIR = 'kalimotxo-installers'

/** Resolves when every process in the bottle has exited (`wineserver -w`). */
function waitForBottleIdle(bottle: string, env: NodeJS.ProcessEnv): Promise<void> {
  const installation = getActiveWineInstallation()
  const wineserver = resolveWineserver(installation)
  return new Promise((resolve) => {
    const child = spawn(wineserver, ['-w'], {
      env: { ...env, WINEPREFIX: getBottlePath(bottle) },
      stdio: 'ignore'
    })
    installWaiter = child
    child.on('error', () => resolve())
    child.on('close', () => resolve())
  })
}

/**
 * Runs a Windows installer (.exe/.msi) in the Games bottle, waits for it to
 * finish and returns the executables it added, best guess first.
 */
export async function installFromInstaller(installerPath: string): Promise<LibraryInstallResult> {
  const fail = (message: string): LibraryInstallResult => {
    setInstallProgress('error', message)
    return { success: false, message, candidates: [], suggestedName: '' }
  }
  if (installRunning) return fail('Another installation is in progress')
  if (!existsSync(installerPath) || !/\.(exe|msi)$/i.test(installerPath)) {
    return fail('Select a Windows installer (.exe or .msi)')
  }

  installRunning = true
  installCancelled = false
  try {
    mkdirSync(LOGS_DIR, { recursive: true })
    writeFileSync(INSTALL_LOG, `--- library install ${new Date().toISOString()} ---\n`)
    installLog(`Installer: ${installerPath}`)

    setInstallProgress('bottle', 'Preparing the Games bottle...')
    const [bottleOk, bottleMsg] = await ensureGamesBottle(installLog, (phase) =>
      setInstallProgress(
        phase,
        phase === 'deps'
          ? 'Installing Visual C++ and DirectX runtimes (first time only)...'
          : 'Creating the Games bottle...'
      )
    )
    if (!bottleOk) return fail(bottleMsg)

    try {
      ensureBattleNetWineRuntimeLibs(getActiveWineInstallation(), installLog)
    } catch (e) {
      installLog(`Warning: runtime libs: ${String(e)}`)
    }
    purgeBrokenWinetempSymlinks(installLog)

    const driveC = join(getBottlePath(GAMES_BOTTLE), 'drive_c')
    const before = snapshotExes(driveC)

    // Run a copy from inside the bottle: downloaders (e.g. Blizzard's) keep
    // their data next to the exe, which in ~/Downloads needs a macOS privacy
    // permission; denying it made the download fail.
    const stamp = String(Date.now())
    const staging = join(driveC, STAGING_DIR, stamp)
    mkdirSync(staging, { recursive: true })
    const installerName = basename(installerPath)
    const staged = join(staging, installerName)
    copyFileSync(installerPath, staged)

    isolateUserFolders(getBottlePath(GAMES_BOTTLE))
    setInstallProgress('installer', 'Installer running — complete it in its window')
    const env = buildInstallerEnv(GAMES_BOTTLE)
    const isMsi = /\.msi$/i.test(installerPath)
    const proc = runExe(GAMES_BOTTLE, isMsi ? 'msiexec' : staged, {
      env,
      cwd: staging,
      args: isMsi ? ['/i', `C:\\${STAGING_DIR}\\${stamp}\\${installerName}`] : [],
      logPath: INSTALL_LOG
    })
    // The installer's own process first (Wine can take seconds to start under
    // Rosetta, so an early `wineserver -w` would return at once), then any
    // setup processes it spawned.
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) resolve()
      else proc.once('exit', () => resolve())
    })
    await waitForBottleIdle(GAMES_BOTTLE, env)
    installWaiter = null
    rmSync(join(driveC, STAGING_DIR), { recursive: true, force: true })
    if (installCancelled) {
      setInstallProgress('idle', 'Installation cancelled')
      return {
        success: false,
        cancelled: true,
        message: 'Installation cancelled',
        candidates: [],
        suggestedName: ''
      }
    }

    setInstallProgress('scanning', 'Looking for the installed game...')
    const candidates = rankExeCandidates(before, snapshotExes(driveC), driveC)
    const suggestedName = nameFromInstaller(installerPath)
    if (!candidates.length) {
      const message = 'The installer finished but added no executables. Add the game manually.'
      setInstallProgress('done', message)
      return { success: true, message, candidates, suggestedName }
    }
    setInstallProgress('done', 'Installation finished — choose the game executable')
    return {
      success: true,
      message: 'Installation finished',
      candidates,
      suggestedName
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  } finally {
    installRunning = false
    installWaiter = null
  }
}

/** Stops the installer: kills the Games bottle's Wine processes. */
export function cancelInstall(): OpResult {
  if (!installRunning) return { success: false, message: 'No installation in progress' }
  installCancelled = true
  killWineServersForBottle(GAMES_BOTTLE, buildInstallerEnv(GAMES_BOTTLE))
  installWaiter?.kill()
  return { success: true, message: 'Installation cancelled' }
}

export function addGame(input: AddLibraryGameInput): OpResult & { game?: LibraryGame } {
  const exe = input.exe
  if (!exe || !/\.exe$/i.test(exe) || !existsSync(exe) || !statSync(exe).isFile()) {
    return { success: false, message: 'Select the game .exe file' }
  }
  const game = addLibraryGameRecord({
    name: input.name.trim() || nameFromExe(exe),
    exe,
    bottle: bottleForExe(exe),
    backend: input.backend ?? detectGraphicsBackend(exe),
    args: input.args ?? []
  })
  notifyChanged()
  return { success: true, message: `${game.name} added to your library`, game }
}

export function updateGame(id: string, patch: UpdateLibraryGameInput): OpResult {
  const clean: UpdateLibraryGameInput = {}
  if (patch.name !== undefined && patch.name.trim()) clean.name = patch.name.trim()
  if (patch.backend) clean.backend = patch.backend
  if (patch.args) clean.args = patch.args.filter(Boolean)
  const game = updateLibraryGameRecord(id, clean)
  if (!game) return { success: false, message: 'Game not found' }
  notifyChanged()
  return { success: true, message: 'Saved' }
}

/** Removes the game from the library. Its files stay in the bottle. */
export function removeGame(id: string): OpResult {
  if (!removeLibraryGameRecord(id)) return { success: false, message: 'Game not found' }
  notifyChanged()
  return { success: true, message: 'Removed from library' }
}

export async function launchGame(id: string): Promise<OpResult> {
  const game = getLibraryGame(id)
  if (!game) return { success: false, message: 'Game not found' }
  if (!existsSync(game.exe)) {
    return { success: false, message: `${game.name}: executable not found (${game.exe})` }
  }
  if (running.has(id)) return { success: true, message: `${game.name} is already running` }

  const logPath = join(LOGS_DIR, `library-${id}.log`)
  mkdirSync(LOGS_DIR, { recursive: true })
  writeFileSync(logPath, `--- launch ${game.name} ${new Date().toISOString()} ---\n`)
  const log = (m: string): void => appendFileSync(logPath, m + '\n')

  if (game.bottle === GAMES_BOTTLE && !isGamesBottleReady()) {
    const [ok, msg] = await ensureGamesBottle(log)
    if (!ok) return { success: false, message: msg }
  }
  if (game.backend === 'd3dmetal') {
    const { isD3dmetalInstalled } = await import('../setup/runtimePaths')
    if (!isD3dmetalInstalled()) {
      const { ensureD3dmetal } = await import('../wine/d3dmetalSetup')
      const [ok, msg] = await ensureD3dmetal({ onLog: log })
      if (!ok) return { success: false, message: msg }
    }
  }
  try {
    ensureBattleNetWineRuntimeLibs(getActiveWineInstallation(), log)
  } catch (e) {
    log(`Warning: runtime libs: ${String(e)}`)
  }
  purgeBrokenWinetempSymlinks(log)

  // Only the shared Games bottle is isolated; bottles like Battle.net keep theirs.
  if (game.bottle === GAMES_BOTTLE) isolateUserFolders(getBottlePath(GAMES_BOTTLE))
  const env = buildLibraryGameEnv(game.bottle, game.backend)
  log(`Bottle: ${game.bottle} | backend: ${game.backend} | args: ${game.args.join(' ')}`)
  log(`Overrides: ${env.WINEDLLOVERRIDES ?? ''}`)
  const proc = runExe(game.bottle, game.exe, {
    env,
    cwd: dirname(game.exe),
    args: game.args,
    logPath
  })
  running.set(id, proc)
  const startedAt = Date.now()
  proc.once('exit', (code) => {
    running.delete(id)
    notifyChanged()
    // A quick non-zero exit is a failed start, not a normal quit.
    if (code && Date.now() - startedAt < 15_000) {
      sendFrontendMessage('gameLaunchError', {
        gameId: id,
        gameName: game.name,
        message: `The game closed on startup. Try another graphics layer in its settings. Log: ${logPath}`
      })
    }
  })
  updateLibraryGameRecord(id, { last_played: new Date().toISOString() })
  notifyChanged()
  logInfo(`[library] launched ${game.name} (${game.backend})`)
  return { success: true, message: `${game.name} is starting` }
}

/** User games plus the Blizzard games installed through Battle.net. */
export function listEntries(): LibraryEntry[] {
  const local: LibraryEntry[] = loadLibrary().map((game) => ({
    id: game.id,
    name: game.name,
    source: 'local',
    backend: game.backend,
    running: running.has(game.id),
    last_played: game.last_played,
    game
  }))
  let blizzard: LibraryEntry[] = []
  if (listBottles().some((b) => b.name === BATTLENET_BOTTLE)) {
    blizzard = listInstalledBlizzardGames().map((g) => ({
      id: g.id,
      name: g.name,
      source: 'battlenet',
      backend: g.backend,
      running: false,
      last_played: null
    }))
  }
  return [...local, ...blizzard].sort((a, b) => a.name.localeCompare(b.name))
}

export function isInstallRunning(): boolean {
  return installRunning
}
