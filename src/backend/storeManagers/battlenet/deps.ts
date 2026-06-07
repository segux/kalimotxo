import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { execSync, spawnSync } from 'child_process'
import { resolveCabextractPath } from '../../setup/toolPaths'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { getBottleConfig, saveBottleConfig } from '../../bottle'
import { resolveBattleNetPrefix } from './prefix'
import { CACHE_DIR } from '../../config/paths'
import { cabextractAvailable } from '../../setup/toolPaths'
import { installBattlenetVerbs } from './winetricksInstall'
import {
  BATTLENET_BOTTLE,
  BATTLENET_LAUNCH_PREP,
  SYSWOW64_UCRT_API_MS,
  SYSWOW64_UCRT_SENTINELS,
  SYSWOW64_VC_DLLS,
  UCRT_DLL_OVERRIDE_NAMES
} from './constants'
import { prepareBottleForLauncher } from './launcherPrep'

function wineWindowsDirs(bottleName: string): [string, string] {
  const base = join(resolveBattleNetPrefix(bottleName), 'drive_c', 'windows')
  return [join(base, 'system32'), join(base, 'syswow64')]
}

export function syncSyswow64VcDlls(bottleName = BATTLENET_BOTTLE): string[] {
  const [system32, syswow64] = wineWindowsDirs(bottleName)
  if (!existsSync(syswow64)) return []
  const copied: string[] = []
  for (const name of SYSWOW64_VC_DLLS) {
    const dest = join(syswow64, name)
    if (existsSync(dest)) continue
    const src = join(system32, name)
    if (existsSync(src)) {
      copyFileSync(src, dest)
      copied.push(name)
    }
  }
  return copied
}

function extractUcrtFromCache(syswow64: string): string[] {
  if (!cabextractAvailable()) return []

  let installer = join(CACHE_DIR, 'vc_redist.x86.exe')
  if (!existsSync(installer)) installer = join(CACHE_DIR, 'vc_redist_2015.x86.exe')
  if (!existsSync(installer)) return []

  const deployed: string[] = []
  const tmp = mkdtempSync(join(tmpdir(), 'kalimotxo-ucrt-'))
  const cab = resolveCabextractPath() ?? 'cabextract'
  try {
    spawnSync(cab, ['-d', tmp, installer, '-F', 'a4'], { timeout: 120_000 })
    let kbCabs = readdirSync(tmp, { recursive: true } as { recursive: boolean })
      .map((f) => (typeof f === 'string' ? join(tmp, f) : ''))
      .filter((p) => p.includes('KB2999226') && p.endsWith('.cab'))
    if (!kbCabs.length) return []
    const kbDir = mkdtempSync(join(tmp, 'kb-'))
    spawnSync(cab, ['-d', kbDir, kbCabs[0]], { timeout: 120_000 })

    function walk(dir: string): void {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile() && e.name.toLowerCase().endsWith('.dll')) {
          const name = e.name.toLowerCase()
          if (!name.startsWith('api-ms-win-crt')) continue
          if (statSync(p).size > 60_000) continue
          const dest = join(syswow64, e.name)
          if (existsSync(dest) && statSync(dest).size > 60_000) continue
          copyFileSync(p, dest)
          deployed.push(e.name)
        }
      }
    }
    walk(kbDir)
  } catch {
    /* skip */
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return deployed
}

export function deploySyswow64Ucrt(bottleName = BATTLENET_BOTTLE): string[] {
  const [, syswow64] = wineWindowsDirs(bottleName)
  if (!existsSync(syswow64)) return []
  const changes: string[] = []
  for (const name of SYSWOW64_UCRT_API_MS) {
    const dest = join(syswow64, name)
    if (existsSync(dest) && statSync(dest).size > 80_000) {
      unlinkSync(dest)
      changes.push(`removed:${name}`)
    }
  }
  changes.push(...extractUcrtFromCache(syswow64))
  const geo = join(syswow64, 'geolocation.dll')
  const loc = join(syswow64, 'locationapi.dll')
  if (existsSync(geo) && !existsSync(loc)) {
    copyFileSync(geo, loc)
    changes.push('locationapi.dll')
  }
  return changes
}

export function applyUcrtOverrides(bottleName = BATTLENET_BOTTLE): void {
  try {
    const cfg = getBottleConfig(bottleName)
    for (const dll of UCRT_DLL_OVERRIDE_NAMES) {
      cfg.dll_overrides[dll] = 'native,builtin'
    }
    saveBottleConfig(bottleName, cfg)
  } catch {
    /* no bottle */
  }
}

export function syncLaunchRuntime(bottleName = BATTLENET_BOTTLE): string[] {
  const changes = syncSyswow64VcDlls(bottleName)
  changes.push(...deploySyswow64Ucrt(bottleName))
  applyUcrtOverrides(bottleName)
  return changes
}

export function bottleHasVcRuntime(bottleName = BATTLENET_BOTTLE): boolean {
  const [, syswow64] = wineWindowsDirs(bottleName)
  if (!existsSync(syswow64)) return false
  return SYSWOW64_VC_DLLS.every((n) => existsSync(join(syswow64, n)))
}

export function bottleHasUcrt(bottleName = BATTLENET_BOTTLE): boolean {
  const [, syswow64] = wineWindowsDirs(bottleName)
  if (!existsSync(syswow64)) return false

  const ucrtbase = join(syswow64, 'ucrtbase.dll')
  if (existsSync(ucrtbase) && statSync(ucrtbase).size >= 100_000) return true

  for (const name of SYSWOW64_UCRT_SENTINELS) {
    const p = join(syswow64, name)
    if (existsSync(p) && statSync(p).size <= 60_000) return true
  }
  try {
    const reg = readFileSync(join(resolveBattleNetPrefix(bottleName), 'user.reg'), 'utf-8')
    if (reg.includes('*api-ms-win-crt-runtime-l1-1-0')) return true
  } catch {
    /* ignore */
  }
  return false
}

export function bottleLaunchDepsOk(bottleName = BATTLENET_BOTTLE): boolean {
  return bottleHasVcRuntime(bottleName) && bottleHasUcrt(bottleName)
}

import { fixBrokenUpdateFolders, isBattleNetInstalled } from './client'

export async function ensureLaunchDependencies(
  log?: (msg: string) => void
): Promise<[boolean, string]> {
  if (!isBattleNetInstalled()) return [true, 'Client not installed yet']

  const logFn = log ?? (() => {})
  const { ensureToolsForWinetricks } = await import('../../setup/ensureEnvironment')
  const [toolsOk, toolsMsg] = await ensureToolsForWinetricks(logFn)
  if (!toolsOk) return [false, toolsMsg]

  const removed = fixBrokenUpdateFolders()
  if (removed) logFn(`Removed ${removed} broken update folder(s)`)

  let mirrored = syncLaunchRuntime()
  if (mirrored.length) logFn(`32-bit DLLs in syswow64: ${mirrored.join(', ')}`)

  if (bottleLaunchDepsOk()) {
    prepareBottleForLauncher()
    return [true, 'Launch dependencies ready']
  }

  logFn('Installing 32-bit runtime (vcrun/ucrt)...')
  const [prepOk, prepMsg] = await installBattlenetVerbs(
    BATTLENET_BOTTLE,
    BATTLENET_LAUNCH_PREP,
    logFn,
    { force: true }
  )
  if (!prepOk) return [false, prepMsg]
  mirrored = syncLaunchRuntime()
  if (mirrored.length) logFn(`32-bit DLLs: ${mirrored.join(', ')}`)
  prepareBottleForLauncher()
  if (!bottleLaunchDepsOk()) {
    return [
      false,
      'Could not install VC++/UCRT DLLs automatically. Check the log in ~/.kalimotxo/logs/'
    ]
  }
  return [true, 'Launch dependencies installed']
}

export { stopWineForWinetricks } from '../../launcher/wineRunner'
