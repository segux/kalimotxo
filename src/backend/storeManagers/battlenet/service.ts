import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import type { BattleNetStatus, InstallProgress } from '../../../common/types/battlenet'
import { BOTTLES_DIR, CACHE_DIR, LOGS_DIR } from '../../config/paths'
import { checkAll } from '../../system/checks'
import { isSetupComplete } from '../../setup/runtime'
import { getBottleConfig, listBottles } from '../../bottle'
import {
  applyBattleNetWindowsRegistry,
  runExe,
  stopWineForWinetricks,
  stopWineProcesses
} from '../../launcher/wineRunner'
import {
  bottlePrefixInitialized,
  reconcileBottleWithActiveWine
} from './prefixReconcile'
import { prepareBattleNetWineLaunch } from '../../wine/prepareLaunch'
import { resolveBattleNetWineInstallation } from '../../wine/compatibilityLayers'
import { ensureBattleNetWineRuntimeLibs } from '../../wine/wineRuntimeLibs'
import { startAgentPortBridge, stopAgentPortBridge } from './agentPortBridge'
import { startGameWatcher, stopGameWatcher } from './gameWatcher'
import { resetWineInstallationCache } from '../../launcher/wineRunner'
import { logInfo } from '../../logger'
import { sendFrontendMessage } from '../../ipc'
import {
  BATTLENET_BOTTLE,
  BATTLENET_DEPS,
  BATTLENET_DEPS_OPTIONAL,
  BATTLENET_LAUNCHER_BACKEND,
  INSTALLER_NAME,
  INSTALLER_URL
} from './constants'
import {
  findBattleNetExe,
  findLauncherExe,
  fixBrokenUpdateFolders,
  isBattleNetInstalled,
  isClientComplete,
  isBattleNetWineProcessRunning,
  resolveBattleNetLaunchExe,
  stopBattleNetClientProcesses
} from './client'
import { bottleLaunchDepsOk, ensureLaunchDependencies, syncLaunchRuntime } from './deps'
import { installBattlenetVerbs } from './winetricksInstall'
import { createBattleNetBottle } from './bottleSetup'
import { prepareBottleForLauncher } from './launcherPrep'
import {
  agentInstallBytes,
  prepareBlizzardInstallerPrefix,
  repairAgentLayoutForInstall,
  startInstallerAgentWatchdog,
  stopBlizzardSetupProcesses,
  stopInstallerAgentWatchdog
} from './installerPrep'
import {
  isAgentLaunchReady,
  maintainBattleNetAgent,
  stopBattleNetAgentProcesses
} from './agent'
import {
  launchBlizzardGame,
  listInstalledBlizzardGames,
  restoreBattleNetLauncherGraphics,
  type BlizzardGameId
} from './games'
import { isD3dmetalInstalled } from '../../setup/runtimePaths'
import { friendlyProgressMessage } from './progressMessages'

let installRunning = false
let repairRunning = false
let launchRunning = false
let clientWatchRunning = false
let lastInstallResult: { success: boolean; message: string } | null = null

const installProgress: InstallProgress = { phase: 'idle', percent: 0, message: '' }

function setProgress(phase: string, percent: number, message: string): void {
  installProgress.phase = phase
  installProgress.percent = Math.max(0, Math.min(100, percent))
  installProgress.message = friendlyProgressMessage(phase, percent, message)
  sendFrontendMessage('battleNetInstallProgress', { ...installProgress })
}

function logInstall(msg: string): void {
  logInfo(msg)
  appendFileSync(join(LOGS_DIR, 'battlenet-install.log'), msg + '\n')
}

function missingDeps(installed: string[], depsOk: boolean): string[] {
  let missing = BATTLENET_DEPS.filter((d) => !installed.includes(d))
  if (installed.includes('vcrun2022')) {
    missing = missing.filter((d) => d !== 'vcrun2019')
  }
  if (depsOk) {
    missing = missing.filter((d) => d !== 'vcrun2022' && d !== 'vcrun2019')
  }
  return missing
}

export function getBattleNetStatus(): BattleNetStatus {
  const bottles = new Set(listBottles().map((b) => b.name))
  const bottleExists = bottles.has(BATTLENET_BOTTLE)
  const clientExe = bottleExists ? findBattleNetExe() : null
  const launcher = bottleExists ? findLauncherExe() : null
  const installerCached = existsSync(join(CACHE_DIR, INSTALLER_NAME))
  const kalimotxoSetupDone =
    installProgress.phase === 'done' || (lastInstallResult?.success ?? false)
  const clientComplete = bottleExists ? isClientComplete() : false
  let installedDeps: string[] = []
  let graphicsBackend: string | null = null
  if (bottleExists) {
    try {
      const cfg = getBottleConfig(BATTLENET_BOTTLE)
      graphicsBackend = cfg.graphics_backend
      installedDeps = [...cfg.installed_deps]
    } catch {
      /* ignore */
    }
  }
  const depsOk = bottleExists ? bottleLaunchDepsOk() : false
  return {
    bottle_exists: bottleExists,
    installed: Boolean(clientExe || launcher),
    client_exe: Boolean(clientExe),
    client_complete: clientComplete,
    exe_found: Boolean(clientExe || launcher),
    awaiting_blizzard_wizard: kalimotxoSetupDone && !clientComplete && !installRunning,
    kalimotxo_setup_done: kalimotxoSetupDone,
    client_watch_running: clientWatchRunning,
    launcher_path: launcher,
    client_path: clientExe,
    installer_cached: installerCached,
    runtime_ready: isSetupComplete(),
    install_running: installRunning,
    repair_running: repairRunning,
    cabextract_installed: checkAll().cabextract.installed,
    gstreamer_installed: checkAll().gstreamer.installed,
    deps_ok: depsOk,
    installed_deps: installedDeps,
    missing_deps: missingDeps(installedDeps, depsOk),
    graphics_backend: graphicsBackend,
    launcher_backend: BATTLENET_LAUNCHER_BACKEND,
    can_install:
      isSetupComplete() && !isBattleNetInstalled() && !installRunning && !repairRunning,
    can_launch: clientComplete && depsOk,
    can_repair:
      isBattleNetInstalled() && isSetupComplete() && !installRunning && !repairRunning,
    can_check_client: isBattleNetInstalled() && !installRunning,
    can_uninstall: isBattleNetInstalled() && !installRunning && !repairRunning,
    installed_games: bottleExists ? listInstalledBlizzardGames() : [],
    d3dmetal_ready: isD3dmetalInstalled()
  }
}

export async function launchGame(
  gameId: string
): Promise<{ success: boolean; message: string }> {
  return launchBlizzardGame(gameId as BlizzardGameId)
}

function pushStatus(): void {
  sendFrontendMessage('battleNetStatus', getBattleNetStatus())
}

export { createBattleNetBottle } from './bottleSetup'

async function installDepsQuick(
  log: (m: string) => void,
  onVerb?: (verb: string, index: number, total: number) => void
): Promise<[boolean, string]> {
  const { ensureBattleNetBottleDepsForInstall } = await import('../../setup/ensureEnvironment')
  return ensureBattleNetBottleDepsForInstall(log, onVerb)
}

async function downloadInstaller(onProgress?: (pct: number) => void): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const dest = join(CACHE_DIR, INSTALLER_NAME)
  if (existsSync(dest) && statSync(dest).size > 1_000_000) return dest

  const res = await fetch(INSTALLER_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  const file = createWriteStream(dest)
  let done = 0
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No body')
  while (true) {
    const { done: d, value } = await reader.read()
    if (d) break
    file.write(Buffer.from(value))
    done += value.length
    if (total && onProgress) onProgress(Math.floor((done / total) * 100))
  }
  await new Promise<void>((resolve, reject) => {
    file.on('finish', () => resolve())
    file.on('error', reject)
    file.end()
  })
  return dest
}

async function runInstallPipeline(): Promise<[boolean, string]> {
  if (isBattleNetInstalled()) {
    return [false, 'Battle.net is already installed. Use Uninstall to remove it.']
  }
  setProgress('runtime', 5, 'Preparing Wine and tools...')
  const { ensureRuntimeReady } = await import('../../setup/ensureEnvironment')
  const [rtOk, rtMsg] = await ensureRuntimeReady((m) => {
    logInstall(m)
    setProgress('runtime', 8, m)
  })
  if (!rtOk) {
    setProgress('error', 0, rtMsg)
    return [false, rtMsg]
  }

  setProgress('bottle', 12, 'Creating Battle.net bottle...')
  createBattleNetBottle()

  const installLog = join(LOGS_DIR, 'battlenet-install.log')
  setProgress('deps', 18, 'Installing Visual C++ and UCRT (may take 5-15 min)...')
  const [depsOk, depsMsg] = await installDepsQuick(logInstall, (verb, index, total) => {
    const pct = 18 + Math.floor((27 * (index + 1)) / total)
    setProgress('deps', pct, `Installing ${verb}... (${index + 1}/${total})`)
  })
  if (!depsOk) {
    setProgress('error', 0, depsMsg)
    return [false, depsMsg]
  }
  setProgress('deps', 45, 'Wine dependencies ready')

  setProgress('download', 50, 'Downloading Blizzard installer...')
  const installer = await downloadInstaller((pct) => {
    setProgress('download', 50 + Math.floor(35 * (pct / 100)), `Downloading... ${pct}%`)
  })

  fixBrokenUpdateFolders()
  syncLaunchRuntime()
  prepareBottleForLauncher()
  prepareBlizzardInstallerPrefix(BATTLENET_BOTTLE, installLog)

  setProgress('installer', 90, 'Opening Blizzard installer...')
  runExe(BATTLENET_BOTTLE, installer, {
    battleNetEnv: true,
    cwd: join(installer, '..'),
    logPath: installLog
  })
  startInstallerAgentWatchdog(BATTLENET_BOTTLE, installLog)
  logInstall('Installer open. Blizzard 45% = Agent download; Kalimotxo watches every 20s.')

  if (findBattleNetExe()) {
    const msg = 'Battle.net installed successfully.'
    setProgress('done', 100, msg)
    return [true, msg]
  }
  const msg =
    'Kalimotxo finished (100%). Complete the Blizzard wizard in the Wine window until the download finishes.'
  setProgress('done', 100, msg)
  startClientWatch()
  return [true, msg]
}

function startClientWatch(): void {
  if (clientWatchRunning || isClientComplete()) return
  clientWatchRunning = true
  let iter = 0
  const id = setInterval(() => {
    iter++
    const agentMb = Math.round(agentInstallBytes() / (1024 * 1024))
    if (agentMb > 0 && iter % 6 === 0) {
      logInstall(`Agent on disk: ~${agentMb} MB`)
    }
    if (isClientComplete()) {
      stopInstallerAgentWatchdog()
      syncLaunchRuntime()
      fixBrokenUpdateFolders()
      setProgress('done', 100, 'Battle.net client installed — you can now click Launch.')
      pushStatus()
      clearInterval(id)
      clientWatchRunning = false
      return
    }
    if (iter >= 720) {
      stopInstallerAgentWatchdog()
      clearInterval(id)
      clientWatchRunning = false
    }
  }, 5000)
}

/** Reopens the installer and wakes the Agent (Blizzard stuck at 45%). */
export async function kickBlizzardInstaller(): Promise<{ success: boolean; message: string }> {
  installRunning = false
  const installLog = join(LOGS_DIR, 'battlenet-install.log')
  mkdirSync(LOGS_DIR, { recursive: true })
  appendFileSync(installLog, `\n--- kick installer ${new Date().toISOString()} ---\n`)

  stopInstallerAgentWatchdog()
  stopBlizzardSetupProcesses()
  stopBattleNetAgentProcesses()
  stopBattleNetClientProcesses()
  stopWineProcesses(BATTLENET_BOTTLE, { wait: false })
  await new Promise((r) => setTimeout(r, 3000))

  if (repairAgentLayoutForInstall(BATTLENET_BOTTLE, installLog)) {
    appendFileSync(installLog, 'Agent 7 MB copied over stub — 45% should advance\n')
  }

  const { ensureBattleNetBottleDepsForInstall } = await import('../../setup/ensureEnvironment')
  const [depsOk, depsMsg] = await ensureBattleNetBottleDepsForInstall((m) => appendFileSync(installLog, m + '\n'))
  if (!depsOk) return { success: false, message: depsMsg }

  syncLaunchRuntime()
  prepareBottleForLauncher()
  prepareBlizzardInstallerPrefix(BATTLENET_BOTTLE, installLog)

  const installer = existsSync(join(CACHE_DIR, INSTALLER_NAME))
    ? join(CACHE_DIR, INSTALLER_NAME)
    : await downloadInstaller()

  runExe(BATTLENET_BOTTLE, installer, {
    battleNetEnv: true,
    cwd: join(installer, '..'),
    logPath: installLog
  })
  startInstallerAgentWatchdog(BATTLENET_BOTTLE, installLog)
  startClientWatch()

  return {
    success: true,
    message: 'Installer opened.'
  }
}

function beginInstallPipeline(): { success: boolean; message: string } {
  if (installRunning) return { success: false, message: 'Installation already in progress' }
  if (isBattleNetInstalled()) {
    return { success: false, message: 'Battle.net is already installed' }
  }
  installRunning = true
  mkdirSync(LOGS_DIR, { recursive: true })
  writeFileSync(join(LOGS_DIR, 'battlenet-install.log'), '--- Battle.net install ---\n')
  setProgress('starting', 0, 'Starting installation...')

  void runInstallPipeline().then(([ok, message]) => {
    installRunning = false
    lastInstallResult = { success: ok, message }
    sendFrontendMessage('battleNetInstallFinished', { success: ok, message })
    pushStatus()
  })

  return { success: true, message: 'Installation started' }
}

export function startInstall(): { success: boolean; message: string } {
  return beginInstallPipeline()
}

/** Waits for the Kalimotxo automated phase to finish (not the Blizzard wizard in Wine). */
export async function runInstallAndWait(): Promise<{ success: boolean; message: string }> {
  if (isBattleNetInstalled()) {
    return { success: true, message: 'Battle.net is already installed' }
  }
  const started = beginInstallPipeline()
  if (!started.success) return started
  while (installRunning) {
    await new Promise((r) => setTimeout(r, 400))
  }
  return lastInstallResult ?? { success: false, message: 'Installation produced no result' }
}

export async function repair(options?: { includeOptional?: boolean }): Promise<{
  success: boolean
  message: string
}> {
  if (repairRunning) return { success: false, message: 'Repair already in progress' }
  repairRunning = true
  try {
    const { ensureToolsForWinetricks } = await import('../../setup/ensureEnvironment')
    const [toolsOk, toolsMsg] = await ensureToolsForWinetricks(logInstall)
    if (!toolsOk) return { success: false, message: toolsMsg }

    if (!listBottles().some((b) => b.name === BATTLENET_BOTTLE)) {
      createBattleNetBottle()
    }
    const verbs = options?.includeOptional
      ? [...BATTLENET_DEPS, ...BATTLENET_DEPS_OPTIONAL]
      : BATTLENET_DEPS
    const [verbsOk, verbsMsg] = await installBattlenetVerbs(
      BATTLENET_BOTTLE,
      verbs,
      logInstall,
      { force: true }
    )
    if (!verbsOk) return { success: false, message: verbsMsg }
    syncLaunchRuntime()
    prepareBottleForLauncher()
    await maintainBattleNetAgent(BATTLENET_BOTTLE, {
      deep: true,
      log: logInstall
    })
    const [ok, msg] = await ensureLaunchDependencies(logInstall)
    pushStatus()
    return { success: ok, message: msg }
  } finally {
    repairRunning = false
  }
}

/**
 * "Repair bottle" wizard: makes the prefix consistent with the active Wine
 * (Wine 11 "Battle.net ready") without losing the client or installed games.
 *
 * Steps: stop all Wine -> registry backup -> single `wineboot --update` with the
 * active Wine (reconciles DLLs/registry after mixing Wine versions) -> reapply
 * the Battle.net Windows registry (win10, crash dialog off) -> reinstall verbs
 * and launch dependencies -> restart the Agent.
 *
 * Useful when the bottle degrades (symptom: client starts but window stays blank /
 * MoltenVK stops initializing). See docs §4.
 */
export async function repairBottle(): Promise<{ success: boolean; message: string }> {
  if (installRunning || launchRunning || repairRunning) {
    return { success: false, message: 'Another operation is in progress — wait for it to finish' }
  }
  repairRunning = true
  const logPath = join(LOGS_DIR, 'battlenet-repair-bottle.log')
  const log = (m: string): void => {
    try {
      appendFileSync(logPath, m + '\n')
    } catch {
      /* ignore */
    }
    logInfo(`[repairBottle] ${m}`)
  }
  try {
    mkdirSync(LOGS_DIR, { recursive: true })
    writeFileSync(logPath, `--- repairBottle ${new Date().toISOString()} ---\n`)
    pushStatus()

    if (!bottlePrefixInitialized(BATTLENET_BOTTLE)) {
      return {
        success: false,
        message:
          'No Battle.net bottle found. Click Open Battle.net to create one first.'
      }
    }

    const { ensureToolsForWinetricks } = await import('../../setup/ensureEnvironment')
    const [toolsOk, toolsMsg] = await ensureToolsForWinetricks(log)
    if (!toolsOk) return { success: false, message: toolsMsg }

    const reconcile = await reconcileBottleWithActiveWine(BATTLENET_BOTTLE, log)
    if (!reconcile.ok) return { success: false, message: reconcile.message }

    log('Reapplying Battle.net Windows registry...')
    applyBattleNetWindowsRegistry(BATTLENET_BOTTLE, { force: true })

    log('Reinstalling VC++/UCRT dependencies...')
    const [verbsOk, verbsMsg] = await installBattlenetVerbs(
      BATTLENET_BOTTLE,
      BATTLENET_DEPS,
      log,
      { force: true }
    )
    if (!verbsOk) return { success: false, message: verbsMsg }

    syncLaunchRuntime()
    prepareBottleForLauncher()
    resetWineInstallationCache()
    fixBrokenUpdateFolders()

    log('Restarting the Update Agent...')
    await maintainBattleNetAgent(BATTLENET_BOTTLE, { deep: true, log })

    const [depsOk, depsMsg] = await ensureLaunchDependencies(log)
    pushStatus()

    const tail = reconcile.backupDir ? ` (registry backed up at ${reconcile.backupDir})` : ''
    return {
      success: depsOk,
      message: depsOk
        ? `Bottle repaired with the active Wine. Try Open Battle.net.${tail}`
        : depsMsg
    }
  } finally {
    repairRunning = false
  }
}

/**
 * Single flow: installs what is missing and opens Battle.net.
 */
export async function play(): Promise<{ success: boolean; message: string }> {
  if (installRunning || launchRunning || repairRunning) {
    return { success: false, message: 'Wait for the current operation to finish' }
  }

  if (!isBattleNetInstalled()) {
    setProgress('starting', 2, 'Starting...')
    const started = beginInstallPipeline()
    if (!started.success) return started

    while (installRunning) {
      await new Promise((r) => setTimeout(r, 400))
    }

    const result = lastInstallResult ?? { success: false, message: 'Installation produced no result' }
    if (!result.success) return result

    if (!isBattleNetInstalled()) {
      return {
        success: true,
        message:
          'Battle.net opened in a window on your Mac. Complete the Blizzard wizard and click Open Battle.net again.'
      }
    }
  }

  return launch()
}

export async function launch(): Promise<{ success: boolean; message: string }> {
  if (launchRunning) {
    return { success: false, message: 'Launch in progress — wait a few seconds' }
  }
  launchRunning = true

  const logPath = join(LOGS_DIR, 'battlenet-launch.log')
  const log = (m: string): void => appendFileSync(logPath, m + '\n')

  try {
    mkdirSync(LOGS_DIR, { recursive: true })
    writeFileSync(logPath, `--- launch ${new Date().toISOString()} ---\n`)

    if (!isBattleNetInstalled()) {
      return {
        success: false,
        message: 'Battle.net is not ready yet. Click Open Battle.net to install it automatically.'
      }
    }

    if (isBattleNetWineProcessRunning()) {
      log('Battle.net open — closing and fully repairing Agent (BLZBNTBNA00000005)...')
      stopBattleNetAgentProcesses()
      stopBattleNetClientProcesses()
      stopWineProcesses(BATTLENET_BOTTLE, { wait: false })
      await new Promise((r) => setTimeout(r, 2500))
    }

    const { ensureBattleNetBottleDeps } = await import('../../setup/ensureEnvironment')
    const [prepOk, prepMsg] = await ensureBattleNetBottleDeps(log)
    if (!prepOk) return { success: false, message: prepMsg }

    let [depsOk, depsMsg] = await ensureLaunchDependencies(log)
    if (!depsOk) {
      log('Retrying VC++/UCRT DLL...')
      const [retryOk, retryMsg] = await ensureBattleNetBottleDeps(log)
      if (!retryOk) return { success: false, message: retryMsg }
      ;[depsOk, depsMsg] = await ensureLaunchDependencies(log)
      if (!depsOk) return { success: false, message: depsMsg }
    }

    restoreBattleNetLauncherGraphics()
    resetWineInstallationCache()
    fixBrokenUpdateFolders()
    syncLaunchRuntime()

    if (!isClientComplete()) {
      return kickBlizzardInstaller()
    }

    const exe = resolveBattleNetLaunchExe()
    if (!exe) {
      return {
        success: false,
        message: 'Battle.net not found. Click Open Battle.net to reinstall it.'
      }
    }

    stopWineProcesses(BATTLENET_BOTTLE, { wait: false })

    const prep = prepareBattleNetWineLaunch(logPath)
    if (!prep.ok) return { success: false, message: prep.message }

    // macOS strips DYLD_* from Wine child processes -> MoltenVK/gnutls do not
    // load via DYLD_FALLBACK. Copying them into lib/wine/x86_64-unix makes them
    // load via @loader_path (GPU + TLS). See wineRuntimeLibs.ts.
    try {
      ensureBattleNetWineRuntimeLibs(resolveBattleNetWineInstallation(), log)
    } catch (e) {
      log(`Warning: could not prepare runtime libs: ${String(e)}`)
    }

    // Bridge 1120 -> Agent's real port (Agent.dat). Without it the client gets
    // CURL error=7 / BLZBNTBNA00000005. See agentPortBridge.ts.
    startAgentPortBridge(BATTLENET_BOTTLE)

    await maintainBattleNetAgent(BATTLENET_BOTTLE, {
      prepareLaunch: true,
      logPath,
      log
    })

    if (!isAgentLaunchReady()) {
      return {
        success: false,
        message:
          'The Battle.net Update Agent is not ready. Click Repair in Settings → Advanced or complete the installation in Wine.'
      }
    }

    const exeName = exe.split(/[/\\]/).pop() ?? 'Battle.net.exe'
    log(`Starting ${exeName}...`)
    // CEF/Chromium flags for the client (CEF 108). All four are required for the
    // window to show and the web content to paint on Apple Silicon:
    // - `--use-angle=vulkan`: ANGLE over Vulkan -> winevulkan -> MoltenVK (Metal).
    //   Battle.net's CEF build ONLY supports ANGLE (gl=swiftshader yields
    //   `gl=none` and the GPU context dies: "process alive, no window").
    // - `--disable-gpu-compositing`: the browser compositor paints in software,
    //   avoiding Skia shader link failures (they use
    //   `GL_NV_shader_noperspective_interpolation`) under ANGLE->MoltenVK.
    // - `--disable-direct-composition`: Chrome presents the window via
    //   DirectComposition, which winemac.drv does not implement -> the window
    //   stays blank. Forcing the classic present path makes the (Qt) chrome paint.
    // - `--in-process-gpu`: the GPU process runs inside the browser process;
    //   without it, cross-process texture sharing fails under Wine and the
    //   embedded web content (login, shop) renders black.
    // Requires `vulkan-1=b` in WINEDLLOVERRIDES (see wineEnv.ts) so ANGLE uses
    // Wine's winevulkan (with VK_KHR_win32_surface) instead of the SwiftShader
    // `vulkan-1.dll` that Battle.net ships in its own folder.
    runExe(BATTLENET_BOTTLE, exe, {
      battleNetEnv: true,
      logPath,
      args: [
        '--use-angle=vulkan',
        '--disable-gpu-compositing',
        '--disable-direct-composition',
        '--in-process-gpu'
      ]
    })

    await new Promise((r) => setTimeout(r, 12_000))

    if (!isBattleNetWineProcessRunning()) {
      return {
        success: false,
        message:
          'Battle.net closed on startup. Click Open Battle.net again; if it persists, check Settings → Advanced.'
      }
    }

    // Start watching for game processes launched by Battle.net.
    // When the user clicks "Play" inside Battle.net, the game inherits the
    // client's wined3d environment (not D3DMetal/DXMT). The watcher detects the
    // process, kills it, and relaunches it with the correct profile.
    startGameWatcher()

    return {
      success: true,
      message: 'Battle.net is open. Install and launch games from the Blizzard library.'
    }
  } finally {
    launchRunning = false
  }
}

export function checkClient(): { success: boolean; message: string } {
  syncLaunchRuntime()
  fixBrokenUpdateFolders()
  pushStatus()
  if (isClientComplete()) {
    return { success: true, message: 'Client complete — ready to launch' }
  }
  return {
    success: false,
    message: 'Client incomplete. Open the Blizzard wizard or click Complete Installation.'
  }
}

export function cancel(): { success: boolean; message: string } {
  stopInstallerAgentWatchdog()
  stopBlizzardSetupProcesses()
  stopBattleNetAgentProcesses()
  stopBattleNetClientProcesses()
  stopAgentPortBridge()
  stopGameWatcher()
  stopWineForWinetricks(BATTLENET_BOTTLE)
  installRunning = false
  repairRunning = false
  launchRunning = false
  clientWatchRunning = false
  setProgress('idle', 0, '')
  pushStatus()
  return {
    success: true,
    message: 'Installation cancelled. Click Start to retry (Agent repaired automatically).'
  }
}

export function uninstall(): { success: boolean; message: string } {
  stopInstallerAgentWatchdog()
  const bottlePath = join(BOTTLES_DIR, BATTLENET_BOTTLE)
  if (existsSync(bottlePath)) {
    rmSync(bottlePath, { recursive: true, force: true })
  }
  lastInstallResult = null
  installProgress.phase = 'idle'
  pushStatus()
  return { success: true, message: 'Battle.net desinstalado' }
}
