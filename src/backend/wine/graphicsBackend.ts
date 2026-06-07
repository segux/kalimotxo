import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'fs'
import { join } from 'path'

import { getBottleConfig, getBottlePath, saveBottleConfig } from '../bottle'
import { D3DMETAL_DIR, DXMT_DIR, DXVK_DIR } from '../config/paths'
import { isD3dmetalInstalled, isDxmtInstalled } from '../setup/runtimePaths'

export type GraphicsBackendId = 'wined3d' | 'dxmt' | 'd3dmetal' | 'dxvk'

const INJECTED_DLLS = new Set([
  'd3d11.dll',
  'd3d10core.dll',
  'd3d9.dll',
  'd3d12.dll',
  'dxgi.dll'
])

const BACKEND_SOURCE: Record<string, string> = {
  dxmt: DXMT_DIR,
  dxvk: DXVK_DIR,
  d3dmetal: D3DMETAL_DIR
}

export function applyGraphicsEnv(
  env: NodeJS.ProcessEnv,
  backend: GraphicsBackendId
): void {
  delete env.DXMT_ASYNC
  delete env.DXMT_LOG_LEVEL
  delete env.D3DMETAL
  delete env.DYLD_FRAMEWORK_PATH
  delete env.DYLD_LIBRARY_PATH
  delete env.DXVK_HUD
  delete env.DXVK_ASYNC

  if (backend === 'dxmt') {
    env.DXMT_ASYNC = '1'
    env.DXMT_LOG_LEVEL = 'none'
  } else if (backend === 'd3dmetal') {
    env.D3DMETAL = '1'
    const fw = join(D3DMETAL_DIR, 'D3DMetal.framework')
    if (existsSync(fw)) {
      env.DYLD_FRAMEWORK_PATH = D3DMETAL_DIR
      env.DYLD_LIBRARY_PATH = D3DMETAL_DIR
    }
  } else if (backend === 'dxvk') {
    env.DXVK_HUD = '0'
    env.DXVK_ASYNC = '1'
  }
}

function findNestedDir(root: string, name: string): string | null {
  const direct = join(root, name)
  if (existsSync(direct)) return direct
  try {
    for (const sub of readdirSync(root)) {
      const p = join(root, sub, name)
      if (existsSync(p)) return p
    }
  } catch {
    /* ignore */
  }
  return null
}

function copyDlls(srcDir: string, destDir: string): string[] {
  const copied: string[] = []
  if (!existsSync(destDir)) return copied
  try {
    for (const name of readdirSync(srcDir)) {
      if (!name.toLowerCase().endsWith('.dll')) continue
      const dest = join(destDir, name)
      if (existsSync(dest) && statSync(dest).size > 0) {
        const bak = `${dest}.bak`
        if (!existsSync(bak)) renameSync(dest, bak)
      }
      copyFileSync(join(srcDir, name), dest)
      copied.push(name)
    }
  } catch {
    /* ignore */
  }
  return copied
}

function applyD3dmetalToBottle(bottleName: string): [boolean, string] {
  const frameworkSrc = join(D3DMETAL_DIR, 'D3DMetal.framework')
  if (!existsSync(frameworkSrc)) {
    return [
      false,
      'D3DMetal not installed. Import GPTK (Apple DMG) or install CrossOver and use Import D3DMetal in Settings.'
    ]
  }

  const bottlePath = getBottlePath(bottleName)
  const destRoot = join(bottlePath, 'd3dmetal')
  const destFw = join(destRoot, 'D3DMetal.framework')
  mkdirSync(destRoot, { recursive: true })
  if (existsSync(destFw)) rmSync(destFw, { recursive: true, force: true })
  cpSync(frameworkSrc, destFw, { recursive: true })

  const dylibSrc = join(D3DMETAL_DIR, 'libd3dshared.dylib')
  if (existsSync(dylibSrc)) {
    copyFileSync(dylibSrc, join(destRoot, 'libd3dshared.dylib'))
  }

  const cfg = getBottleConfig(bottleName)
  cfg.graphics_backend = 'd3dmetal'
  saveBottleConfig(bottleName, cfg)
  return [true, 'D3DMetal applied to bottle (DX12)']
}

function applyDllBackend(
  bottleName: string,
  backend: 'dxmt' | 'dxvk'
): [boolean, string] {
  const sourceDir = BACKEND_SOURCE[backend]
  if (!existsSync(sourceDir)) {
    return [false, `Runtime ${backend} no encontrado en ${sourceDir}`]
  }

  const bottlePath = getBottlePath(bottleName)
  const system32 = join(bottlePath, 'drive_c', 'windows', 'system32')
  const syswow64 = join(bottlePath, 'drive_c', 'windows', 'syswow64')

  const x64Name = backend === 'dxmt' ? 'x86_64-windows' : 'x64'
  const x32Name = backend === 'dxmt' ? 'i386-windows' : 'x32'
  const x64 = findNestedDir(sourceDir, x64Name)
  const x32 = findNestedDir(sourceDir, x32Name)

  const copied: string[] = []
  if (x64) copied.push(...copyDlls(x64, system32))
  if (x32) copied.push(...copyDlls(x32, syswow64))
  if (!copied.length) return [false, `No ${backend} DLLs found in runtime`]

  const cfg = getBottleConfig(bottleName)
  cfg.graphics_backend = backend
  saveBottleConfig(bottleName, cfg)
  return [true, `${backend}: ${copied.join(', ')}`]
}

/** Changes the bottle's graphics layer (like CrossOver / CPTK). */
export function applyGraphicsBackend(
  bottleName: string,
  backend: GraphicsBackendId
): [boolean, string] {
  if (backend === 'wined3d') {
    const cfg = getBottleConfig(bottleName)
    cfg.graphics_backend = 'wined3d'
    saveBottleConfig(bottleName, cfg)
    return [true, 'Graphics layer: Wine built-in (Battle.net)']
  }
  if (backend === 'd3dmetal') {
    if (!isD3dmetalInstalled()) {
      return [false, 'D3DMetal not in runtime. Import GPTK or from CrossOver.']
    }
    return applyD3dmetalToBottle(bottleName)
  }
  if (backend === 'dxmt') {
    if (!isDxmtInstalled()) return [false, 'DXMT not installed']
    return applyDllBackend(bottleName, 'dxmt')
  }
  if (backend === 'dxvk') {
    return applyDllBackend(bottleName, 'dxvk')
  }
  return [false, `Unknown backend: ${backend}`]
}

export function applyGraphicsEnvForBottle(
  env: NodeJS.ProcessEnv,
  bottleName: string
): GraphicsBackendId {
  let backend: GraphicsBackendId = 'wined3d'
  try {
    backend = getBottleConfig(bottleName).graphics_backend as GraphicsBackendId
  } catch {
    /* default */
  }

  if (backend === 'd3dmetal') {
    const bottlePath = getBottlePath(bottleName)
    const local = join(bottlePath, 'd3dmetal')
    if (existsSync(join(local, 'D3DMetal.framework'))) {
      env.D3DMETAL = '1'
      env.DYLD_FRAMEWORK_PATH = local
      env.DYLD_LIBRARY_PATH = local
      return backend
    }
  }

  applyGraphicsEnv(env, backend)
  return backend
}
