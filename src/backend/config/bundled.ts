import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

/** Directorio `resources/bundled` (dev o empaquetado). */
export function getBundledDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bundled')
  }
  return join(process.cwd(), 'resources', 'bundled')
}

export function getBundledWinetricksPath(): string | null {
  const p = join(getBundledDir(), 'winetricks')
  return existsSync(p) ? p : null
}

export function getBundledCabextractPath(): string | null {
  const p = join(getBundledDir(), 'tools', 'cabextract')
  return existsSync(p) ? p : null
}

/** GPTK/D3DMetal colocado a mano en `resources/bundled/d3dmetal` (no se commitea). */
export function getBundledD3dmetalDir(): string {
  return join(getBundledDir(), 'd3dmetal')
}

export function isBundledD3dmetalPresent(): boolean {
  const dir = getBundledD3dmetalDir()
  return (
    existsSync(join(dir, 'D3DMetal.framework')) ||
    existsSync(join(dir, 'libd3dshared.dylib'))
  )
}
