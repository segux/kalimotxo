import { spawn } from 'child_process'
import { createHash } from 'crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync
} from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

import type { WineInstallation } from './types'
import { setupWineEnvVars } from './wineEnv'
import { resolveWineserver } from './wineserverPath'

/**
 * Wine Gecko (mshtml: embedded browsers, HTML EULAs, launchers) and Wine Mono
 * (.NET). A new prefix normally prompts to download them; Kalimotxo creates
 * prefixes with them disabled to avoid that blocking dialog, which also skips
 * registering mshtml/mscoree. Without this, e.g. the Diablo II installer showed
 * a blank license and could not continue (ieframe: class not registered).
 *
 * Versions and SHA-256s come from the active Wine's own appwiz.cpl, so a new
 * Wine build brings its matching add-ons without code changes.
 */

export interface WineAddons {
  gecko: { version: string; sha: { x86: string; x86_64: string } }
  mono: { version: string; sha: string }
}

const VERSION_RE = /^\d+\.\d+\.\d+$/
const SHA_RE = /^[0-9a-f]{64}$/

/** Printable ASCII runs, like `strings`. */
function asciiStrings(buf: Buffer): string[] {
  return buf.toString('latin1').match(/[\x20-\x7e]{6,}/g) ?? []
}

/**
 * appwiz.cpl keeps, in order: Gecko version, Gecko SHA for its architecture,
 * Mono version, Mono SHA.
 */
function parseAppwiz(file: string): { versions: string[]; shas: string[] } | null {
  try {
    const strings = asciiStrings(readFileSync(file))
    return {
      versions: strings.filter((s) => VERSION_RE.test(s)),
      shas: strings.filter((s) => SHA_RE.test(s))
    }
  } catch {
    return null
  }
}

function wineRoot(installation: WineInstallation): string {
  return dirname(dirname(installation.bin)) // <root>/bin/wine
}

export function readWineAddons(installation: WineInstallation): WineAddons | null {
  const lib = join(wineRoot(installation), 'lib', 'wine')
  const x64 = parseAppwiz(join(lib, 'x86_64-windows', 'appwiz.cpl'))
  const x86 = parseAppwiz(join(lib, 'i386-windows', 'appwiz.cpl'))
  if (!x64 || !x86 || x64.versions.length < 2 || x64.shas.length < 2 || x86.shas.length < 1) {
    return null
  }
  return {
    gecko: { version: x64.versions[0]!, sha: { x86: x86.shas[0]!, x86_64: x64.shas[0]! } },
    mono: { version: x64.versions[1]!, sha: x64.shas[1]! }
  }
}

/** Wine's own download cache: it installs add-ons found here without asking. */
function wineCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'wine')
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

/** Downloads `url` into the cache unless a file with the right SHA is there. */
async function cachedDownload(url: string, sha: string): Promise<string> {
  const dest = join(wineCacheDir(), url.split('/').pop()!)
  if (existsSync(dest) && (await sha256(dest)) === sha) return dest
  mkdirSync(dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}): ${url}`)
  const tmp = `${dest}.part`
  const out = createWriteStream(tmp)
  const reader = res.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out.write(Buffer.from(value))
  }
  await new Promise<void>((resolve, reject) => {
    out.on('finish', () => resolve())
    out.on('error', reject)
    out.end()
  })
  if ((await sha256(tmp)) !== sha) {
    rmSync(tmp, { force: true })
    throw new Error(`Checksum mismatch: ${url}`)
  }
  rmSync(dest, { force: true })
  renameSync(tmp, dest)
  return dest
}

function run(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('error', (e) => resolve({ code: null, stderr: String(e) }))
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

function toWindowsPath(unixPath: string): string {
  return 'Z:' + unixPath.replace(/\//g, '\\')
}

/**
 * Installs the Gecko and Mono versions the active Wine expects into `prefix`
 * and registers mshtml. Idempotent: returns the add-ons it installed.
 */
export async function ensureWineAddons(
  prefix: string,
  installation: WineInstallation,
  log: (m: string) => void
): Promise<string[]> {
  const addons = readWineAddons(installation)
  if (!addons) {
    log('Wine add-ons: versions not found in this Wine build, skipping')
    return []
  }
  const env = setupWineEnvVars({ ...process.env, WINEDEBUG: '-all' }, installation, {
    winePrefix: prefix
  })
  const wine = installation.bin
  const wineserver = resolveWineserver(installation)
  const win = join(prefix, 'drive_c', 'windows')

  /** Runs an MSI and checks it produced `expected`; retries once on a settled wineserver. */
  const installMsi = async (msi: string, expected: string): Promise<void> => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await run(wine, ['msiexec', '/i', toWindowsPath(msi), '/qn'], env)
      await run(wineserver, ['-w'], env)
      if (existsSync(expected)) return
      log(`msiexec ${msi.split('/').pop()} did not install (exit ${r.code}), attempt ${attempt}`)
      if (r.stderr.trim()) log(r.stderr.trim().split('\n').slice(-5).join('\n'))
    }
    throw new Error(`Could not install ${msi.split('/').pop()}`)
  }
  const done: string[] = []
  const { version: gv, sha: gsha } = addons.gecko

  if (
    !existsSync(join(win, 'system32', 'gecko', gv)) ||
    !existsSync(join(win, 'syswow64', 'gecko', gv))
  ) {
    log(`Installing Wine Gecko ${gv} (web content in installers and launchers)...`)
    for (const arch of ['x86', 'x86_64'] as const) {
      const msi = await cachedDownload(
        `https://dl.winehq.org/wine/wine-gecko/${gv}/wine-gecko-${gv}-${arch}.msi`,
        gsha[arch]
      )
      await installMsi(msi, join(win, arch === 'x86' ? 'syswow64' : 'system32', 'gecko', gv))
    }
    done.push(`wine-gecko-${gv}`)
  }
  // Registration was skipped when the prefix was created with mshtml disabled.
  await run(wine, ['regsvr32', '/s', 'mshtml.dll'], env)
  await run(wine, ['C:\\windows\\syswow64\\regsvr32.exe', '/s', 'mshtml.dll'], env)

  const { version: mv, sha: msha } = addons.mono
  if (!existsSync(join(win, 'mono', 'mono-2.0'))) {
    log(`Installing Wine Mono ${mv} (.NET games and launchers)...`)
    const msi = await cachedDownload(
      `https://dl.winehq.org/wine/wine-mono/${mv}/wine-mono-${mv}-x86.msi`,
      msha
    )
    await installMsi(msi, join(win, 'mono', 'mono-2.0'))
    done.push(`wine-mono-${mv}`)
  }

  await run(wineserver, ['-w'], env)
  return done
}
