import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'

import { getBottlePath } from '../../bottle'
import {
  buildEnv,
  getWineBinary,
  stopWineProcesses
} from '../../launcher/wineRunner'

export interface ReconcileResult {
  ok: boolean
  message: string
  backupDir?: string
}

/** Wine prefix registry files. */
const REG_FILES = ['system.reg', 'user.reg', 'userdef.reg'] as const

/**
 * Copies the bottle's `.reg` files to `.reg-backup-<timestamp>` inside the prefix.
 * Returns the backup path, or null if there were no registry files to copy.
 */
export function backupBottleRegistry(bottleName: string): string | null {
  const prefix = getBottlePath(bottleName)
  if (!existsSync(prefix)) return null
  const present = REG_FILES.filter((f) => existsSync(join(prefix, f)))
  if (present.length === 0) return null
  const backupDir = join(prefix, `.reg-backup-${Date.now()}`)
  mkdirSync(backupDir, { recursive: true })
  for (const f of present) {
    try {
      copyFileSync(join(prefix, f), join(backupDir, f))
    } catch {
      /* ignore */
    }
  }
  return backupDir
}

/** Whether the prefix has an initialized `drive_c` (not an empty folder). */
export function bottlePrefixInitialized(bottleName: string): boolean {
  const driveC = join(getBottlePath(bottleName), 'drive_c')
  if (!existsSync(driveC)) return false
  try {
    return readdirSync(driveC).length > 0
  } catch {
    return false
  }
}

/**
 * Reconciles a prefix that may have become inconsistent after mixing Wine versions
 * (documented symptom in docs/battlenet-wine-problemas-y-roadmap.md §4): stops all
 * known wineservers, backs up the registry, and runs a single `wineboot --update`
 * with the **active Wine** (Wine 11 "Battle.net ready"). Does not delete `drive_c`,
 * so the client and installed games are preserved.
 */
export async function reconcileBottleWithActiveWine(
  bottleName: string,
  log: (msg: string) => void = () => {}
): Promise<ReconcileResult> {
  const prefix = getBottlePath(bottleName)
  if (!existsSync(prefix)) {
    return { ok: false, message: `Bottle "${bottleName}" does not exist.` }
  }

  let wine: string
  try {
    wine = getWineBinary(bottleName)
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : 'Kalimotxo Wine is not ready. Complete the runtime download.'
    }
  }

  // 1) Stop ALL Wine for this prefix (all known wineservers + wait).
  log('Closing Wine processes for the bottle...')
  stopWineProcesses(bottleName, { wait: true })

  // 2) Back up the registry before touching anything.
  const backupDir = backupBottleRegistry(bottleName)
  if (backupDir) log(`Registry backed up at ${backupDir}`)

  // 3) Single wineboot --update with the active Wine to reconcile the prefix.
  log('Reconciling prefix with the active Wine (wineboot --update)...')
  const env = buildEnv(bottleName)
  const res = spawnSync(wine, ['wineboot', '--update'], {
    env,
    timeout: 240_000,
    encoding: 'utf-8'
  })

  if (res.error) {
    return {
      ok: false,
      message: `wineboot --update failed: ${res.error.message}`,
      backupDir: backupDir ?? undefined
    }
  }
  if (typeof res.status === 'number' && res.status !== 0) {
    return {
      ok: false,
      message: `wineboot --update exited with code ${res.status}. Check the log.`,
      backupDir: backupDir ?? undefined
    }
  }

  // 4) Leave the prefix at rest (wineserver shuts down automatically after update).
  stopWineProcesses(bottleName, { wait: false })

  return {
    ok: true,
    message: 'Prefix reconciled with the active Wine.',
    backupDir: backupDir ?? undefined
  }
}
