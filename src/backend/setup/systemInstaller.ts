import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { checkGstreamer as checkGstLegacy, checkRosetta } from '../system/checks'
import {
  cabextractAvailable,
  copyCabextractFromSystem,
  downloadCabextractBottle,
  gstreamerAvailable
} from './toolPaths'
import { logInfo } from '../logger'

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn('which', [cmd])
    let out = ''
    p.stdout?.on('data', (d) => {
      out += d.toString()
    })
    p.on('close', (code) => resolve(code === 0 ? out.trim() || null : null))
    p.on('error', () => resolve(null))
  })
}

function getBrewPath(): Promise<string | null> {
  return which('brew').then(async (brew) => {
    if (brew) return brew
    const arm = '/opt/homebrew/bin/brew'
    const intel = '/usr/local/bin/brew'
    if (existsSync(arm)) return arm
    if (existsSync(intel)) return intel
    return null
  })
}

function runBrew(args: string[], onLog?: (line: string) => void): Promise<[boolean, string]> {
  return new Promise(async (resolve) => {
    const brew = await getBrewPath()
    if (!brew) {
      resolve([false, 'Homebrew is not installed'])
      return
    }
    const lines: string[] = []
    const proc = spawn(brew, args, {
      env: {
        ...process.env,
        HOMEBREW_NO_AUTO_UPDATE: '1',
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`
      }
    })
    proc.stdout?.on('data', (d) => {
      const s = d.toString()
      lines.push(s)
      onLog?.(s.trim())
    })
    proc.stderr?.on('data', (d) => {
      const s = d.toString()
      lines.push(s)
      onLog?.(s.trim())
    })
    proc.on('close', (code) => {
      const out = lines.join('\n').slice(-4000)
      resolve([code === 0, out || (code === 0 ? 'OK' : `brew exit ${code}`)])
    })
    proc.on('error', (e) => resolve([false, e.message]))
  })
}

/** Runs a command with administrator privileges (macOS dialog). */
function runWithAdmin(shellCommand: string): Promise<[boolean, string]> {
  const escaped = shellCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return new Promise((resolve) => {
    const proc = spawn(
      'osascript',
      ['-e', `do shell script "${escaped}" with administrator privileges`],
      { env: process.env }
    )
    let out = ''
    let err = ''
    proc.stdout?.on('data', (d) => {
      out += d.toString()
    })
    proc.stderr?.on('data', (d) => {
      err += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve([true, out.trim() || 'OK'])
      else resolve([false, err.trim() || out.trim() || `osascript exit ${code}`])
    })
    proc.on('error', (e) => resolve([false, e.message]))
  })
}

export async function isHomebrewInstalled(): Promise<boolean> {
  return (await getBrewPath()) !== null
}

export async function installHomebrew(onLog?: (line: string) => void): Promise<[boolean, string]> {
  if (await isHomebrewInstalled()) return [true, 'Homebrew already installed']
  const log = onLog ?? (() => {})
  log('Installing Homebrew (may ask for your macOS password)…')
  const cmd =
    'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  const [ok, msg] = await runWithAdmin(cmd)
  if (ok && (await isHomebrewInstalled())) {
    return [true, 'Homebrew instalado']
  }
  return [
    false,
    msg ||
      'Could not install Homebrew. Install it from https://brew.sh and click Install All again.'
  ]
}

export async function installRosetta(onLog?: (line: string) => void): Promise<[boolean, string]> {
  if (checkRosetta().installed) return [true, 'Rosetta already installed']
  const log = onLog ?? (() => {})
  log('Installing Rosetta 2…')
  const [ok, msg] = await runWithAdmin(
    'softwareupdate --install-rosetta --agree-to-license'
  )
  if (ok || checkRosetta().installed) return [true, 'Rosetta installed']
  return [false, msg]
}

export function isSystemDepsReady(): boolean {
  return cabextractAvailable() && gstreamerAvailable()
}

export async function ensureCabextract(onLog?: (line: string) => void): Promise<[boolean, string]> {
  if (cabextractAvailable()) return [true, 'cabextract available']

  const log = onLog ?? (() => {})
  if (copyCabextractFromSystem()) return [true, 'cabextract copied to Kalimotxo runtime']

  if (await downloadCabextractBottle(log)) return [true, 'cabextract downloaded by Kalimotxo']

  if (await isHomebrewInstalled()) {
    logInfo('Installing cabextract via Homebrew…')
    const [ok, msg] = await runBrew(['install', 'cabextract'], onLog)
    if (ok && copyCabextractFromSystem()) return [true, 'cabextract instalado con Homebrew']
    if (ok) return [true, 'cabextract instalado con Homebrew']
    return [false, msg]
  }

  return [false, 'Could not obtain cabextract. Install Homebrew or click Install All.']
}

export async function ensureGstreamer(onLog?: (line: string) => void): Promise<[boolean, string]> {
  if (gstreamerAvailable()) return [true, 'GStreamer available']

  const log = onLog ?? (() => {})
  if (!(await isHomebrewInstalled())) {
    return [false, 'GStreamer requires Homebrew. Click "Install All" first.']
  }

  logInfo('Installing GStreamer via Homebrew…')
  const [ok, msg] = await runBrew(
    ['install', 'gstreamer', 'gst-plugins-base', 'gst-plugins-good', 'gst-libav'],
    onLog
  )
  if (gstreamerAvailable() || checkGstLegacy().installed) {
    return [true, 'GStreamer instalado']
  }
  if (ok) return [true, 'GStreamer installed (restart Kalimotxo if not detected)']
  return [false, msg]
}

export async function installSystemDependencies(
  onLog?: (line: string) => void
): Promise<{ success: boolean; message: string }> {
  const log = onLog ?? (() => {})

  await installRosetta(log)

  if (!(await isHomebrewInstalled())) {
    const [brewOk, brewMsg] = await installHomebrew(log)
    if (!brewOk) return { success: false, message: brewMsg }
  }

  const [cabOk, cabMsg] = await ensureCabextract(log)
  if (!cabOk) return { success: false, message: cabMsg }

  const [gstOk, gstMsg] = await ensureGstreamer(log)
  if (!gstOk) return { success: false, message: gstMsg }

  return { success: true, message: 'System dependencies ready' }
}
