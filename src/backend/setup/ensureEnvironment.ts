import { existsSync } from 'fs'
import { join } from 'path'

import { listBottles } from '../bottle'
import { CACHE_DIR } from '../config/paths'
import { logInfo } from '../logger'
import { cabextractAvailable, gstreamerAvailable } from './toolPaths'
import { downloadAll, isSetupComplete } from './runtime'
import {
  bottleLaunchDepsOk,
  syncLaunchRuntime
} from '../storeManagers/battlenet/deps'
import {
  BATTLENET_BOTTLE,
  BATTLENET_DEPS,
  BATTLENET_DEPS_QUICK,
  BATTLENET_LAUNCH_PREP
} from '../storeManagers/battlenet/constants'
import { installBattlenetVerbs } from '../storeManagers/battlenet/winetricksInstall'
import { createBattleNetBottle } from '../storeManagers/battlenet/bottleSetup'
import { installSystemDependencies } from './systemInstaller'

const VC_REDIST_URL =
  'https://download.microsoft.com/download/9/0/6/906AD0A8-70FB-4926-8A83-8F50A7746B39/vc_redist.x86.exe'

async function ensureVcRedistCache(log: (m: string) => void): Promise<void> {
  const dest = join(CACHE_DIR, 'vc_redist.x86.exe')
  if (existsSync(dest)) return
  const alt = join(CACHE_DIR, 'vc_redist_2015.x86.exe')
  if (existsSync(alt)) return
  log('Downloading Visual C++ Redistributable (UCRT)…')
  try {
    const res = await fetch(VC_REDIST_URL, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1_000_000) throw new Error('file too small')
    const { writeFileSync, mkdirSync } = await import('fs')
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(dest, buf)
    log('vc_redist.x86.exe cached')
  } catch (e) {
    log(
      `Warning: could not download vc_redist (${e instanceof Error ? e.message : String(e)}); winetricks will try to fetch it`
    )
  }
}

/** cabextract (+ GStreamer if possible) without requiring manual steps. */
export async function ensureToolsForWinetricks(
  log: (m: string) => void = logInfo
): Promise<[boolean, string]> {
  if (!cabextractAvailable()) {
    log('Fetching cabextract…')
    const sys = await installSystemDependencies(log)
    if (!sys.success && !cabextractAvailable()) {
      const { ensureCabextract } = await import('./systemInstaller')
      const [cabOk, cabMsg] = await ensureCabextract(log)
      if (!cabOk) return [false, cabMsg]
    }
  }

  if (!cabextractAvailable()) {
    return [false, 'Could not install cabextract automatically']
  }

  if (!gstreamerAvailable()) {
    log('Checking GStreamer (Wine audio)…')
    const { ensureGstreamer, isHomebrewInstalled, installHomebrew } = await import(
      './systemInstaller'
    )
    if (!(await isHomebrewInstalled())) {
      log('Installing Homebrew for GStreamer (macOS may ask for your password once)…')
      const [brewOk, brewMsg] = await installHomebrew(log)
      if (!brewOk) {
        log(`Warning: ${brewMsg} — continuing with cabextract only`)
      }
    }
    const [gstOk, gstMsg] = await ensureGstreamer(log)
    if (!gstOk) {
      log(`GStreamer warning: ${gstMsg} — VC++/UCRT DLLs can still be installed`)
    }
  }

  await ensureVcRedistCache(log)
  return [true, 'System tools ready']
}

/** Wine, DXMT, winetricks in ~/.kalimotxo or ~/.macbattlenet. */
export async function ensureRuntimeReady(
  log: (m: string) => void = logInfo
): Promise<[boolean, string]> {
  const [toolsOk, toolsMsg] = await ensureToolsForWinetricks(log)
  if (!toolsOk) return [false, toolsMsg]

  if (isSetupComplete()) return [true, 'Kalimotxo runtime ready']

  log('Downloading Wine, DXMT and winetricks (first run, may take several minutes)…')
  const rt = await downloadAll()
  if (!rt.success) return [false, rt.message]
  if (!isSetupComplete()) {
    return [false, 'Incomplete runtime after download — retry in a few seconds']
  }
  return [true, rt.message]
}

/** Battle.net bottle + VC++/UCRT DLLs in syswow64. */
export async function ensureBattleNetBottleDeps(
  log: (m: string) => void = logInfo
): Promise<[boolean, string]> {
  const [rtOk, rtMsg] = await ensureRuntimeReady(log)
  if (!rtOk) return [false, rtMsg]

  if (!listBottles().some((b) => b.name === BATTLENET_BOTTLE)) {
    log('Creating Battle.net bottle…')
    createBattleNetBottle()
  }

  let mirrored = syncLaunchRuntime()
  if (mirrored.length) log(`DLL syswow64: ${mirrored.join(', ')}`)

  if (bottleLaunchDepsOk()) {
    return [true, 'VC++/UCRT dependencies ready']
  }

  log('Installing Wine dependencies (vcrun, UCRT, d3dcompiler)…')
  const allVerbs = [...new Set([...BATTLENET_DEPS, ...BATTLENET_LAUNCH_PREP])]
  const [verbsOk, verbsMsg] = await installBattlenetVerbs(BATTLENET_BOTTLE, allVerbs, log, {
    force: true
  })
  if (!verbsOk) return [false, verbsMsg]

  mirrored = syncLaunchRuntime()
  if (mirrored.length) log(`DLL syswow64: ${mirrored.join(', ')}`)

  if (!bottleLaunchDepsOk()) {
    return [
      false,
      'Could not deploy VC++/UCRT DLLs. Check ~/.kalimotxo/logs/battlenet-install.log'
    ]
  }
  return [true, 'VC++/UCRT dependencies installed']
}

/** Initial install: minimal deps only (faster; avoids stalling at 45% in Kalimotxo). */
export async function ensureBattleNetBottleDepsForInstall(
  log: (m: string) => void = logInfo,
  onVerb?: (verb: string, index: number, total: number) => void
): Promise<[boolean, string]> {
  const [rtOk, rtMsg] = await ensureRuntimeReady(log)
  if (!rtOk) return [false, rtMsg]

  if (!listBottles().some((b) => b.name === BATTLENET_BOTTLE)) {
    log('Creating Battle.net bottle…')
    createBattleNetBottle()
  }

  let mirrored = syncLaunchRuntime()
  if (mirrored.length) log(`DLL syswow64: ${mirrored.join(', ')}`)

  if (bottleLaunchDepsOk()) {
    return [true, 'Dependencies ready']
  }

  const verbs = [...BATTLENET_DEPS_QUICK]
  log(`Installing ${verbs.length} Wine packages (vcrun, UCRT)…`)

  for (let i = 0; i < verbs.length; i++) {
    const verb = verbs[i]!
    onVerb?.(verb, i, verbs.length)
    log(`→ ${verb}…`)
    const [ok, out] = await installBattlenetVerbs(BATTLENET_BOTTLE, [verb], log, {
      force: true
    })
    if (!ok) return [false, `Failed ${verb}: ${out.slice(0, 280)}`]
    log(`✓ ${verb}`)
  }

  mirrored = syncLaunchRuntime()
  if (mirrored.length) log(`DLL syswow64: ${mirrored.join(', ')}`)

  if (!bottleLaunchDepsOk()) {
    return [
      false,
      'Missing VC++/UCRT DLLs. Check ~/.kalimotxo/logs/battlenet-install.log or click Repair.'
    ]
  }
  return [true, 'Dependencies ready']
}
