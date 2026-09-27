import { createHash } from 'crypto'
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { spawnSync } from 'child_process'
import { basename, dirname, join } from 'path'

import { DXMT_DIR, RUNTIME_DIR } from '../config/paths'
import { resolveWineExternalDir } from './wineEnv'
import type { WineInstallation } from './types'

/**
 * Why DXMT needs its own copy of Wine:
 *
 * Wine looks for builtin DLLs in its own `lib/wine` first and only then in
 * `WINEDLLPATH`, and it skips builtin-marked DLLs found anywhere else (system32,
 * the game folder) in favour of its own. So DXMT on `WINEDLLPATH` never
 * replaces Wine's `d3d11`/`dxgi`: DXMT games silently ran on wined3d (Vulkan ->
 * MoltenVK), and D2R crashed in MoltenVK (`MVKBufferView::getMTLTexture`) when
 * loading into a game.
 *
 * Wine takes its DLL dir from the real path of `ntdll.so`, so a hard-linked
 * mirror of the Wine tree (no extra disk) with DXMT's DLLs in its `lib/wine`
 * makes every process started with the mirror's `bin/wine` use DXMT, while the
 * Battle.net client and other games keep Wine's own DLLs (D3DMetal, wined3d).
 * Both share one wineserver: it is the same build.
 */

/** DXMT files that replace (or add to) Wine's own, per `lib/wine` subdir. */
const DXMT_FILES: Record<string, string[]> = {
  'x86_64-windows': ['d3d11.dll', 'dxgi.dll', 'd3d10core.dll', 'winemetal.dll'],
  'i386-windows': ['d3d11.dll', 'dxgi.dll', 'd3d10core.dll', 'winemetal.dll'],
  'x86_64-unix': ['winemetal.so']
}

const MARKER = '.kalimotxo-dxmt.json'

/** A DXMT release: the dir holding `x86_64-windows`, `i386-windows`, `x86_64-unix`. */
function isDxmtRoot(dir: string): boolean {
  return (
    existsSync(join(dir, 'x86_64-windows', 'd3d11.dll')) &&
    existsSync(join(dir, 'x86_64-unix', 'winemetal.so'))
  )
}

/** DXMT bundled with the Wine (`lib/external/dxmt`), else `runtime/dxmt[/<version>]`. */
export function resolveDxmtRoot(installation: WineInstallation): string | null {
  const candidates: string[] = []
  const ext = resolveWineExternalDir(installation)
  if (ext) candidates.push(join(ext, 'dxmt'))
  candidates.push(DXMT_DIR)
  try {
    for (const name of readdirSync(DXMT_DIR).sort().reverse()) candidates.push(join(DXMT_DIR, name))
  } catch {
    /* no runtime/dxmt */
  }
  return candidates.find(isDxmtRoot) ?? null
}

/** `<root>` for a `<root>/bin/wine` layout with `<root>/lib/wine`. */
function wineRootOf(installation: WineInstallation): string | null {
  const root = dirname(dirname(installation.bin))
  return existsSync(join(root, 'lib', 'wine')) ? root : null
}

function fileSig(path: string): string {
  try {
    const st = statSync(path)
    return `${st.size}:${Math.floor(st.mtimeMs)}`
  } catch {
    return '-'
  }
}

/**
 * Changes whenever the Wine or DXMT on disk change, including the dylibs that
 * wineRuntimeLibs.ts adds to `x86_64-unix` after install.
 */
function signature(wineRoot: string, wineBin: string, dxmtRoot: string): string {
  const unixDir = join(wineRoot, 'lib', 'wine', 'x86_64-unix')
  let unix: string[] = []
  try {
    unix = readdirSync(unixDir)
      .sort()
      .map((n) => `${n}=${fileSig(join(unixDir, n))}`)
  } catch {
    /* compared as empty */
  }
  const dxmt = Object.entries(DXMT_FILES).flatMap(([sub, names]) =>
    names.map((n) => `${sub}/${n}=${fileSig(join(dxmtRoot, sub, n))}`)
  )
  return JSON.stringify({ v: 3, wineRoot, wine: fileSig(wineBin), dxmtRoot, dxmt, unix })
}

/**
 * CrossOver's Wine starts each process from `$TMPDIR/winetemp-<id>-<size>-<mtime>`,
 * named after its loader binary, holding a link to the `ntdll.so` it was first
 * started with. A hard-linked loader has the same inode, size and mtime as the
 * original, so the mirror reused the original's winetemp dir and loaded the
 * original `ntdll.so` (and with it Wine's own d3d11/dxgi). The loaders (`bin/`
 * and the executables in `lib/wine/x86_64-unix`) are copied instead.
 */
function mustCopy(rel: string): boolean {
  if (rel.startsWith('bin/')) return true
  return rel.startsWith('lib/wine/x86_64-unix/') && !/\.(so|dylib)$/.test(rel)
}

/** Hard-links `src` into `dest` (copying loaders and across volumes), keeping symlinks. */
function mirrorTree(src: string, dest: string, rel = ''): void {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    const from = join(src, name)
    const to = join(dest, name)
    const relPath = rel ? `${rel}/${name}` : name
    const st = lstatSync(from)
    if (st.isSymbolicLink()) {
      symlinkSync(readlinkSync(from), to)
    } else if (st.isDirectory()) {
      mirrorTree(from, to, relPath)
    } else if (st.isFile()) {
      if (mustCopy(relPath)) {
        copyFileSync(from, to)
        continue
      }
      try {
        linkSync(from, to)
      } catch {
        copyFileSync(from, to)
      }
    }
  }
}

const MH_MAGIC_64 = 0xfeedfacf
const LC_LOAD_DYLIB = 0x0c
const LC_LOAD_WEAK_DYLIB = 0x80000018
const LC_REEXPORT_DYLIB = 0x8000001f

/**
 * DXMT's `winemetal.so` links `winemac.so` by the absolute path of the Wine it
 * was built against (`/Users/runner/work/dxmt/.../winemac.so`), which does not
 * exist on the user's Mac: dyld failed to load it and D2R reported "Failed to
 * initialize graphics device". Rewrites absolute dylib dependencies that do
 * not exist to `@loader_path/<name>` (the Wine unix libs next to it), in place
 * in the load command. Thin 64-bit Mach-O only; returns the rewritten paths.
 */
export function relinkMissingDylibs(buf: Buffer, exists: (p: string) => boolean): string[] {
  if (buf.length < 32 || buf.readUInt32LE(0) !== MH_MAGIC_64) return []
  const ncmds = buf.readUInt32LE(16)
  const changed: string[] = []
  let off = 32
  for (let i = 0; i < ncmds && off + 8 <= buf.length; i++) {
    const cmd = buf.readUInt32LE(off)
    const size = buf.readUInt32LE(off + 4)
    if (size < 8 || off + size > buf.length) break
    if (cmd === LC_LOAD_DYLIB || cmd === LC_LOAD_WEAK_DYLIB || cmd === LC_REEXPORT_DYLIB) {
      const nameOff = off + buf.readUInt32LE(off + 8)
      const end = buf.indexOf(0, nameOff)
      const path = buf.toString('utf8', nameOff, end < 0 || end > off + size ? off + size : end)
      const replacement = `@loader_path/${basename(path)}`
      if (path.startsWith('/') && !exists(path) && nameOff + replacement.length < off + size) {
        buf.fill(0, nameOff, off + size)
        buf.write(replacement, nameOff, 'utf8')
        changed.push(path)
      }
    }
    off += size
  }
  return changed
}

/** Points winemetal.so at the Wine next to it and re-signs it (ad hoc). */
function relinkWinemetal(file: string, log?: (m: string) => void): void {
  const buf = readFileSync(file)
  const changed = relinkMissingDylibs(buf, existsSync)
  if (!changed.length) return
  writeFileSync(file, buf)
  log?.(`winemetal.so: ${changed.map((p) => basename(p)).join(', ')} -> @loader_path`)
  // Editing a load command invalidates the signature; macOS kills code whose
  // signature does not match, so re-sign it ad hoc (codesign ships with macOS).
  if (process.platform === 'darwin') {
    const r = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', file], { encoding: 'utf-8' })
    if (r.status !== 0) log?.(`codesign winemetal.so failed: ${(r.stderr || '').trim()}`)
  }
}

/**
 * Builds (or reuses) at `dest` a mirror of the Wine at `wineRoot` whose
 * `lib/wine` carries DXMT's DLLs. Returns false if a DXMT file is missing.
 */
export function buildDxmtWine(
  wineRoot: string,
  wineBin: string,
  dxmtRoot: string,
  dest: string,
  log?: (m: string) => void
): boolean {
  const required = DXMT_FILES['x86_64-windows'].map((n) => join(dxmtRoot, 'x86_64-windows', n))
  if (!required.every((p) => existsSync(p))) return false

  const sig = signature(wineRoot, wineBin, dxmtRoot)
  try {
    if (readFileSync(join(dest, MARKER), 'utf-8') === sig) return true
  } catch {
    /* not built yet */
  }

  log?.(`Preparing Wine with DXMT (${basename(dxmtRoot)})...`)
  const tmp = `${dest}.tmp`
  rmSync(tmp, { recursive: true, force: true })
  mirrorTree(wineRoot, tmp)
  for (const [sub, names] of Object.entries(DXMT_FILES)) {
    for (const name of names) {
      const from = join(dxmtRoot, sub, name)
      if (!existsSync(from)) continue
      const to = join(tmp, 'lib', 'wine', sub, name)
      mkdirSync(dirname(to), { recursive: true })
      // Unlink first: writing into a hard link would change the original Wine.
      rmSync(to, { force: true })
      copyFileSync(from, to)
      if (name.endsWith('.so')) relinkWinemetal(to, log)
    }
  }
  writeFileSync(join(tmp, MARKER), sig)
  rmSync(dest, { recursive: true, force: true })
  renameSync(tmp, dest)
  return true
}

/**
 * The active Wine with DXMT as its D3D10/11 and DXGI, for DXMT games; null
 * (use the plain Wine) if DXMT is not installed or the layout is unknown.
 */
export function ensureDxmtWine(
  installation: WineInstallation,
  log?: (m: string) => void
): WineInstallation | null {
  const wineRoot = wineRootOf(installation)
  const dxmtRoot = resolveDxmtRoot(installation)
  if (!wineRoot || !dxmtRoot) {
    log?.(`DXMT Wine unavailable (${!wineRoot ? 'unknown Wine layout' : 'DXMT not installed'})`)
    return null
  }
  const id = createHash('sha1').update(wineRoot).digest('hex').slice(0, 12)
  const dest = join(RUNTIME_DIR, 'wine-dxmt', id)
  try {
    if (!buildDxmtWine(wineRoot, installation.bin, dxmtRoot, dest, log)) {
      log?.(`DXMT Wine unavailable (incomplete DXMT in ${dxmtRoot})`)
      return null
    }
  } catch (e) {
    log?.(`DXMT Wine unavailable: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
  const rel = (p: string): string => join(dest, p.slice(wineRoot.length))
  return {
    ...installation,
    bin: rel(installation.bin),
    wineserver: installation.wineserver?.startsWith(wineRoot + '/')
      ? rel(installation.wineserver)
      : installation.wineserver
  }
}
