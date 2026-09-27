import { spawn } from 'child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

import { CONFIG_FILENAME, getBottleConfig, getBottlePath, saveBottleConfig } from '../bottle'
import { getActiveWineInstallation } from '../launcher/wineRunner'
import { installBattlenetVerbs } from '../storeManagers/battlenet/winetricksInstall'
import { setupWineEnvVars } from '../wine/wineEnv'
import { resolveWineserver } from '../wine/wineserverPath'

/**
 * Shared bottle for games that are not managed by a store launcher. Kept apart
 * from the Battle.net bottle, whose prefix is tuned for the Blizzard client.
 */
export const GAMES_BOTTLE = 'Games'

/**
 * Windows 10 build 19042, Vulkan (MoltenVK) renderer for wined3d and no crash
 * dialog — the same defaults the Battle.net bottle gets.
 */
const GAMES_BOTTLE_REGISTRY = [
  'REGEDIT4',
  '',
  '[HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows NT\\CurrentVersion]',
  '"CurrentVersion"="10.0"',
  '"CurrentBuild"="19042"',
  '"CurrentBuildNumber"="19042"',
  '',
  '[HKEY_CURRENT_USER\\Software\\Wine\\Direct3D]',
  '"renderer"="vulkan"',
  '',
  '[HKEY_CURRENT_USER\\Software\\Wine\\WineDbg]',
  '"ShowCrashDialog"=dword:00000000',
  ''
].join('\r\n')

/** Runtimes most PC games expect; installed once when the bottle is created. */
const GAMES_BOTTLE_DEPS = ['vcrun2022', 'd3dcompiler_47'] as const

/** Wine links these Windows user folders to the Mac's own by default. */
const LINKED_USER_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos', 'Templates']

/**
 * Turns the bottle's links to the Mac's home folders (Documents, Downloads…)
 * into plain folders inside the bottle. Games then keep their files in the
 * bottle, and macOS never prompts Kalimotxo for access to personal folders;
 * a denied prompt made installers fail. The marker file keeps the folder
 * non-empty so Wine does not turn it back into a link on a prefix update.
 */
export function isolateUserFolders(prefix: string): string[] {
  const usersDir = join(prefix, 'drive_c', 'users')
  const home = homedir()
  const changed: string[] = []
  let users: string[] = []
  try {
    users = readdirSync(usersDir)
  } catch {
    return changed
  }
  for (const user of users) {
    for (const folder of LINKED_USER_FOLDERS) {
      const p = join(usersDir, user, folder)
      try {
        if (!lstatSync(p).isSymbolicLink()) continue
        const target = resolve(join(usersDir, user), readlinkSync(p))
        if (!target.startsWith(home + '/') && target !== home) continue
        // unlink, not rm: rm follows a link to a directory and fails.
        unlinkSync(p)
        mkdirSync(p)
        writeFileSync(join(p, '.kalimotxo'), 'Kept inside the Kalimotxo bottle.\n')
        changed.push(`${user}/${folder}`)
      } catch {
        /* missing or not a link */
      }
    }
  }
  return changed
}

export function isGamesBottleReady(): boolean {
  const prefix = getBottlePath(GAMES_BOTTLE)
  return existsSync(join(prefix, CONFIG_FILENAME)) && existsSync(join(prefix, 'system.reg'))
}

function run(bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: 'ignore' })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    const done = (): void => {
      clearTimeout(timer)
      resolve()
    }
    child.on('error', done)
    child.on('close', done)
  })
}

/** `wineboot --init` without blocking the Electron main thread. */
async function initPrefix(prefix: string): Promise<boolean> {
  const installation = getActiveWineInstallation()
  const env = setupWineEnvVars(
    // Without these, a new prefix stops on the Wine Mono / Gecko install
    // prompts and wineboot hangs for minutes.
    { ...process.env, WINEDEBUG: '-all', WINEDLLOVERRIDES: 'mscoree,mshtml=' },
    installation,
    { winePrefix: prefix }
  )
  await run(installation.bin, ['wineboot', '--init'], env, 180_000)
  // One regedit while the wineserver is still warm (separate `reg add` calls
  // after it exits cold-start Wine each time).
  const regFile = join(prefix, 'drive_c', 'kalimotxo-games-defaults.reg')
  writeFileSync(regFile, GAMES_BOTTLE_REGISTRY)
  await run(installation.bin, ['regedit', '/S', 'C:\\kalimotxo-games-defaults.reg'], env, 60_000)
  rmSync(regFile, { force: true })
  // wineboot returns before the wineserver writes system.reg/user.reg, which
  // happens when the server exits: wait for it.
  const wineserver = resolveWineserver(installation)
  await run(wineserver, ['-w'], env, 60_000)
  // The registry files can land a few seconds after `-w` returns.
  const deadline = Date.now() + 30_000
  while (!existsSync(join(prefix, 'system.reg')) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250))
  }
  return existsSync(join(prefix, 'system.reg'))
}

export async function ensureGamesBottle(
  log: (m: string) => void,
  onPhase?: (phase: 'bottle' | 'deps') => void
): Promise<[boolean, string]> {
  const prefix = getBottlePath(GAMES_BOTTLE)
  if (!existsSync(join(prefix, CONFIG_FILENAME))) {
    saveBottleConfig(GAMES_BOTTLE, {
      name: GAMES_BOTTLE,
      windows_version: 'win10',
      graphics_backend: 'dxmt',
      // Every process in a prefix must agree on the sync mode.
      sync_mode: 'msync',
      high_dpi: false,
      env_vars: { WINEMSYNC: '1' },
      dll_overrides: {},
      created_at: new Date().toISOString(),
      installed_apps: [],
      installed_deps: [],
      wine_version: getActiveWineInstallation().name
    })
  }

  if (!existsSync(join(prefix, 'system.reg'))) {
    onPhase?.('bottle')
    log('Creating the Games bottle...')
    if (!(await initPrefix(prefix))) {
      return [false, 'Could not create the Wine prefix for games']
    }
  }

  const installed = new Set(getBottleConfig(GAMES_BOTTLE).installed_deps)
  const missing = GAMES_BOTTLE_DEPS.filter((d) => !installed.has(d))
  if (missing.length) {
    onPhase?.('deps')
    log(`Installing ${missing.join(', ')}...`)
    const [ok, msg] = await installBattlenetVerbs(GAMES_BOTTLE, missing, log)
    if (!ok) return [false, msg]
  }
  // Wine creates the Windows user profile (and its links to the Mac's folders)
  // the first time a program runs, i.e. during the steps above.
  const isolated = isolateUserFolders(prefix)
  if (isolated.length) log(`Isolated user folders from the Mac: ${isolated.join(', ')}`)
  return [true, 'Games bottle ready']
}
