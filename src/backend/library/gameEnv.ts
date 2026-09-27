import { getBottleConfig, getBottlePath } from '../bottle'
import { getActiveWineInstallation } from '../launcher/wineRunner'
import { applyGraphicsEnv } from '../wine/graphicsBackend'
import { applyMacGameStack, mergeDllOverrides, setupWineEnvVars } from '../wine/wineEnv'
import type { LibraryGraphicsBackend } from '../../common/types/library'

/**
 * DLL overrides per graphics layer. DXMT and D3DMetal replace Wine's D3D/DXGI
 * builtins, so those must load as builtin (from WINEDLLPATH / the D3DMetal
 * loader) rather than any native copy a game or installer dropped.
 */
const BACKEND_OVERRIDES: Record<LibraryGraphicsBackend, string[]> = {
  dxmt: ['d3d11=builtin', 'dxgi=builtin', 'd3d10core=builtin'],
  d3dmetal: ['d3d11=builtin', 'd3d12=builtin', 'dxgi=builtin'],
  wined3d: [],
  'wined3d-gl': []
}

function baseEnv(bottle: string): NodeJS.ProcessEnv {
  let bottleEnvVars: Record<string, string> = {}
  try {
    bottleEnvVars = getBottleConfig(bottle).env_vars
  } catch {
    /* bottle without config: defaults */
  }
  return setupWineEnvVars({ ...process.env }, getActiveWineInstallation(), {
    winePrefix: getBottlePath(bottle),
    bottleEnvVars,
    gameLaunch: true
  })
}

/**
 * Launch environment for a library game: the same macOS stack as Blizzard
 * games (MoltenVK, gnutls, WRITECOPY, Rosetta AVX) without the Battle.net
 * client's overrides, which disable .NET, Gecko and Media Foundation
 * (needed by many games for video).
 */
export function buildLibraryGameEnv(
  bottle: string,
  backend: LibraryGraphicsBackend
): NodeJS.ProcessEnv {
  const env = baseEnv(bottle)
  applyMacGameStack(env, getActiveWineInstallation(), {
    dxmt: backend === 'dxmt',
    heapZero: false
  })
  const wined3d = backend === 'wined3d' || backend === 'wined3d-gl'
  applyGraphicsEnv(env, wined3d ? 'wined3d' : backend)
  if (backend === 'wined3d-gl') {
    // Per process, so the bottle's default (Vulkan) stays for other games.
    // wined3d's OpenGL renderer is its most complete one: e.g. Diablo II
    // aborts on the Vulkan one (vkCreateImageView) and runs on OpenGL.
    env.WINE_D3D_CONFIG = 'renderer=gl'
  }
  if (wined3d) {
    // Plain Wine D3D: do not route through CrossOver's D3DMetal backend.
    delete env.CX_ACTIVE_GRAPHICS_BACKEND
    delete env.CX_APPLEGPTK_LIBD3DSHARED_PATH
  }
  env.WINEDLLOVERRIDES = mergeDllOverrides(env.WINEDLLOVERRIDES, BACKEND_OVERRIDES[backend])
  // applyMacGameStack silences everything; keep errors for the game log.
  env.WINEDEBUG = 'fixme-all,err+module'
  return env
}

/** Installers only need a working prefix: no graphics layer overrides. */
export function buildInstallerEnv(bottle: string): NodeJS.ProcessEnv {
  const env = baseEnv(bottle)
  applyMacGameStack(env, getActiveWineInstallation(), { dxmt: false, heapZero: false })
  delete env.WINE_DISABLE_VA_ALLOC
  return env
}
