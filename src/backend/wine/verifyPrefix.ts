import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { getBottlePath } from '../bottle'
import { setupWineEnvVars } from './wineEnv'
import { killWineServersForEnv } from './wineServerKill'
import type { WineInstallation } from './types'

const REQUIRED_PREFIX_FILES = [
  'dosdevices',
  'drive_c',
  'system.reg',
  'user.reg',
  'userdef.reg'
]

export function prefixFilesPresent(bottleName: string): boolean {
  const prefix = getBottlePath(bottleName)
  return REQUIRED_PREFIX_FILES.every((f) => existsSync(join(prefix, f)))
}

/**
 * Heroic: `wineboot --init` si falta system.reg en el prefix.
 */
export function verifyWinePrefix(
  bottleName: string,
  installation: WineInstallation
): { ok: boolean; message: string } {
  if (installation.type === 'crossover') {
    return { ok: true, message: 'CrossOver bottle (sin WINEPREFIX propio)' }
  }

  const prefix = getBottlePath(bottleName)
  const systemReg = join(prefix, 'system.reg')
  if (!existsSync(prefix)) {
    mkdirSync(prefix, { recursive: true })
  }

  if (existsSync(systemReg)) {
    return { ok: true, message: 'Prefix Wine listo' }
  }

  const wine64 = installation.bin.replace(/wine$/, 'wine64')
  const env = setupWineEnvVars(
    { ...process.env, WINEDEBUG: '-all' },
    installation,
    { winePrefix: prefix }
  )
  killWineServersForEnv(env, prefix)

  const r = spawnSync(wine64, ['wineboot', '--init'], {
    env,
    timeout: 120_000,
    encoding: 'utf-8'
  })

  if (r.status !== 0) {
    return {
      ok: false,
      message: (r.stderr || r.stdout || 'wineboot --init failed').slice(0, 300)
    }
  }
  return { ok: true, message: 'Wine prefix initialized' }
}
