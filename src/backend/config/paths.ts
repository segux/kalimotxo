import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'

export const APP_NAME = 'Kalimotxo'
export const APP_VERSION = '0.2.0'

export const DATA_DIR = join(homedir(), '.kalimotxo')
export const RUNTIME_DIR = join(DATA_DIR, 'runtime')
export const BOTTLES_DIR = join(DATA_DIR, 'bottles')
export const CACHE_DIR = join(DATA_DIR, 'cache')
export const LOGS_DIR = join(DATA_DIR, 'logs')
export const WINE_DIR = join(RUNTIME_DIR, 'wine')
export const DXMT_DIR = join(RUNTIME_DIR, 'dxmt')
export const DXVK_DIR = join(RUNTIME_DIR, 'dxvk')
export const D3DMETAL_DIR = join(RUNTIME_DIR, 'd3dmetal')
export const WINETRICKS_PATH = join(RUNTIME_DIR, 'winetricks')
export const WINE_RELEASES_PATH = join(DATA_DIR, 'wine-releases.json')
export const CONFIG_PATH = join(DATA_DIR, 'config.json')

export const DOWNLOAD_URLS: Record<string, string> = {
  wine: 'https://github.com/Gcenx/macOS_Wine_builds/releases/download/11.6_1/wine-staging-11.6_1-osx64.tar.xz',
  dxmt: 'https://github.com/3Shain/dxmt/releases/download/v0.74/dxmt-v0.74-builtin.tar.gz',
  dxvk:
    'https://github.com/Gcenx/DXVK-macOS/releases/download/v1.10.3-20230507-repack/dxvk-macOS-async-v1.10.3-20230507-repack.tar.gz',
  winetricks: 'https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks'
}

export function ensureDirectories(): void {
  for (const d of [
    DATA_DIR,
    RUNTIME_DIR,
    BOTTLES_DIR,
    CACHE_DIR,
    LOGS_DIR,
    WINE_DIR,
    DXMT_DIR,
    DXVK_DIR,
    D3DMETAL_DIR
  ]) {
    mkdirSync(d, { recursive: true })
  }
}

export function loadGlobalConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function saveGlobalConfig(data: Record<string, unknown>): void {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export function detectHardware(): Record<string, unknown> {
  let chip = 'Unknown'
  let ramGb = 0
  try {
    chip = execSync('sysctl -n machdep.cpu.brand_string', { encoding: 'utf-8' }).trim()
    const ram = execSync('sysctl -n hw.memsize', { encoding: 'utf-8' }).trim()
    ramGb = Math.floor(parseInt(ram, 10) / 1024 ** 3)
  } catch {
    /* ignore */
  }
  return {
    chip,
    arch: process.arch,
    macos_version: process.getSystemVersion?.() ?? 'Unknown',
    ram_gb: ramGb,
    has_rosetta2: existsSync('/Library/Apple/usr/share/rosetta')
  }
}
