import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { execSync, spawnSync } from 'child_process'

import { getBottlePath } from '../bottle'
import { WINE_DIR } from '../config/paths'
import { findWine64InTree } from './manager/installed'
import { loadCatalog } from './manager/catalog'
import { getRuntimeWineInstallation } from './compatibilityLayers'
import type { WineInstallation } from './types'
import { resolveWineserver, wineserverSibling } from './wineserverPath'

function wineserverPath(installation: WineInstallation): string | null {
  const ws = resolveWineserver(installation)
  return ws && existsSync(ws) ? ws : null
}

/** Every wineserver of the Wine runtimes Kalimotxo installed (active, catalog, legacy). */
export function collectWineserverPaths(): string[] {
  const paths = new Set<string>()
  const add = (installation: WineInstallation | null): void => {
    const ws = installation ? wineserverPath(installation) : null
    if (ws) paths.add(ws)
  }

  add(getRuntimeWineInstallation())
  for (const rel of loadCatalog()) {
    if (!rel.is_installed) continue
    if (!rel.install_dir) continue
    const wine64 = findWine64InTree(rel.install_dir)
    if (!wine64) continue
    const ws = wineserverSibling(wine64)
    if (existsSync(ws)) paths.add(ws)
  }
  const legacy = findWine64InTree(WINE_DIR)
  if (legacy) {
    const ws = wineserverSibling(legacy)
    if (existsSync(ws)) paths.add(ws)
  }

  return [...paths]
}

/**
 * Mata wineserver del prefix con cada binario conocido (tras cambiar de Wine-Staging a
 * Wine-Crossover el servidor viejo suele quedar en 768 y el cliente en 932).
 */
export function killWineServersForEnv(env: NodeJS.ProcessEnv, bottlePrefix?: string): void {
  for (const ws of collectWineserverPaths()) {
    try {
      spawnSync(ws, ['-k'], { env, timeout: 12_000 })
    } catch {
      /* ignore */
    }
  }

  if (bottlePrefix) {
    try {
      execSync(`pkill -9 -f "${bottlePrefix.replace(/"/g, '\\"')}"`, { timeout: 5000 })
    } catch {
      /* ignore */
    }
  }

  // Last resort only: `wineserver -k` exits cleanly and flushes the registry
  // (user.reg holds the Battle.net login token). SIGKILL skips that flush.
  // Targeted at this prefix's server so other bottles keep running.
  const leftovers = bottlePrefix
    ? waitForPrefixServerExit(bottlePrefix)
    : []
  for (const pid of leftovers) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

/**
 * PIDs of the wineserver serving `prefix`. Wine keeps one server per prefix in
 * `/tmp/.wine-<uid>/server-<dev>-<inode>/` and holds its `lock` file open.
 */
export function wineserverPidsForPrefix(prefix: string): number[] {
  let lock: string
  try {
    const st = statSync(prefix, { bigint: true })
    const uid = process.getuid?.() ?? 0
    const dir = `server-${st.dev.toString(16)}-${st.ino.toString(16)}`
    lock = join('/tmp', `.wine-${uid}`, dir, 'lock')
  } catch {
    return []
  }
  if (!existsSync(lock)) return []
  const r = spawnSync('lsof', ['-t', lock], { encoding: 'utf-8', timeout: 3000 })
  return (r.stdout ?? '')
    .split('\n')
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
}

function waitForPrefixServerExit(prefix: string): number[] {
  for (let i = 0; i < 10; i++) {
    const pids = wineserverPidsForPrefix(prefix)
    if (!pids.length) return []
    spawnSync('sleep', ['0.2'])
  }
  return wineserverPidsForPrefix(prefix)
}

export function killWineServersForBottle(
  bottleName: string,
  env: NodeJS.ProcessEnv
): void {
  killWineServersForEnv(env, getBottlePath(bottleName))
}
