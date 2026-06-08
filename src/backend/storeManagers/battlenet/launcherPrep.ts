import { getBottleConfig, saveBottleConfig } from '../../bottle'
import { BATTLENET_BOTTLE, BATTLENET_LAUNCHER_BACKEND, UCRT_DLL_OVERRIDE_NAMES } from './constants'

const GRAPHICS_STRIP = new Set([
  'DXMT_ASYNC',
  'DXMT_LOG_LEVEL',
  'MTL_HUD_ENABLED',
  'D3DMETAL',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_LIBRARY_PATH',
  'DXVK_HUD',
  'DXVK_ASYNC',
  'WINE_DISABLE_VA_ALLOC'
])
const GRAPHICS_DLL = new Set(['d3d11', 'd3d12', 'd3d10core', 'd3d9', 'dxgi'])

export function sanitizeBattleNetConfig(bottleName = BATTLENET_BOTTLE): void {
  try {
    const cfg = getBottleConfig(bottleName)
    cfg.graphics_backend = BATTLENET_LAUNCHER_BACKEND
    // June 2026: Battle.net + D2R both use msync now. The wineserver MUST
    // run with WINEMSYNC=1 so that child game processes (D2R launched by
    // Battle.net through the Agent) inherit the correct sync mode. Without
    // it D2R crashes with err:sync:msync_init when the parent wineserver
    // uses msync but the child does not.
    cfg.sync_mode = 'msync'
    delete cfg.env_vars.WINEESYNC
    cfg.env_vars.WINEMSYNC = '1'
    for (const key of GRAPHICS_STRIP) {
      delete cfg.env_vars[key]
    }
    for (const dll of Object.keys(cfg.dll_overrides)) {
      if (GRAPHICS_DLL.has(dll)) delete cfg.dll_overrides[dll]
    }
    const presets: Record<string, string> = {
      vcruntime140_1: 'native,builtin',
      msvcp140_1: 'native,builtin',
      // D2R (and other Blizzard games) need mf/winegstreamer disabled
      // to avoid CrossOver Media Foundation crashes. Battle.net's CEF
      // launcher UI does not use MF, so this is safe for the launcher too.
      mf: 'disabled',
      winegstreamer: 'disabled',
      location: 'd',
      locationapi: 'd',
      d3d11: 'builtin',
      dxgi: 'builtin',
      d3d10core: 'builtin'
    }
    for (const [dll, mode] of Object.entries(presets)) {
      cfg.dll_overrides[dll] = mode
    }
    for (const dll of UCRT_DLL_OVERRIDE_NAMES) {
      cfg.dll_overrides[dll] = 'native,builtin'
    }
    saveBottleConfig(bottleName, cfg)
  } catch {
    /* no config */
  }
}

export function prepareBottleForLauncher(bottleName = BATTLENET_BOTTLE): [boolean, string] {
  sanitizeBattleNetConfig(bottleName)
  return [true, 'Launcher bottle prepared (wined3d)']
}
