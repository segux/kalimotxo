import { buildBattleNetLaunchEnv } from '../../../launcher/wineRunner'
import { setupWineEnvVars, isCrossOverRealBinary } from '../../../wine/wineEnv'
import type { WineInstallation } from '../../../wine/types'

jest.mock('../../../bottle', () => ({
  getBottleConfig: () => ({
    name: 'Battle.net',
    env_vars: { WINEESYNC: '1', WINEMSYNC: '1', DXMT_ASYNC: '1' },
    sync_mode: 'esync',
    dll_overrides: {},
    windows_version: 'win10',
    graphics_backend: 'wined3d',
    high_dpi: false,
    created_at: '',
    installed_apps: [],
    installed_deps: [],
    wine_version: null
  }),
  getBottlePath: () => '/tmp/bottle'
}))

jest.mock('../../../setup/runtime', () => ({
  findWine64: () => '/fake/Wine.app/Contents/Resources/wine/bin/wine64'
}))

jest.mock('../../../wine/compatibilityLayers', () => ({
  resolveBattleNetWineInstallation: () => ({
    bin: '/fake/wine',
    name: 'Test',
    type: 'wine'
  }),
  resolveCrossoverBottleName: () => undefined
}))

describe('buildBattleNetLaunchEnv', () => {
  it('aplica el stack «Battle.net ready» (D4Mac) en el cliente', () => {
    const env = buildBattleNetLaunchEnv('Battle.net')
    // esync/msync y vars gráficas se eliminan para el cliente CEF
    expect(env.WINEESYNC).toBeUndefined()
    expect(env.WINEMSYNC).toBeUndefined()
    expect(env.DXMT_ASYNC).toBeUndefined()
    // VA_ALLOC es solo para juegos, NO para el cliente (crasheaba el Agent)
    expect(env.WINE_DISABLE_VA_ALLOC).toBeUndefined()
    // Parches CodeWeavers que CEF necesita en macOS ARM
    expect(env.WINE_SIMULATE_WRITECOPY).toBe('1')
    expect(env.WINE_HEAP_ZERO_MEMORY).toBe('1')
    expect(env.WINE_LARGE_ADDRESS_AWARE).toBe('1')
    // IE embebido / .NET fuera para reducir ruido (no d3d11=b builtin roto)
    expect(String(env.WINEDLLOVERRIDES)).toContain('mscoree=d')
    expect(String(env.WINEDLLOVERRIDES)).toContain('mshtml=d')
    expect(String(env.WINEDLLOVERRIDES)).toContain('locationapi=d')
    expect(String(env.WINEDLLOVERRIDES)).not.toContain('d3d11=b')
  })
})

describe('setupWineEnvVars — soporte WRITECOPY por tipo de Wine', () => {
  const staging: WineInstallation = {
    bin: '/fake/wine',
    name: 'Wine Staging 11.9',
    type: 'wine'
  }
  const cx: WineInstallation = {
    bin: '/fake/wine',
    name: 'wine-cx26.1',
    type: 'wine'
  }

  it('omite WRITECOPY en Wine Staging (deadlock en loader_section)', () => {
    const env = setupWineEnvVars({}, staging, {
      winePrefix: '/tmp/bottle',
      battleNetLaunch: true
    })
    expect(env.WINE_SIMULATE_WRITECOPY).toBeUndefined()
    // El resto del stack sí se aplica
    expect(env.WINE_HEAP_ZERO_MEMORY).toBe('1')
  })

  it('activa WRITECOPY en builds tipo CrossOver / D4Mac', () => {
    const env = setupWineEnvVars({}, cx, {
      winePrefix: '/tmp/bottle',
      battleNetLaunch: true
    })
    expect(env.WINE_SIMULATE_WRITECOPY).toBe('1')
  })
})

describe('isCrossOverRealBinary', () => {
  it('detects the real CrossOver binary path', () => {
    const realCx: WineInstallation = {
      bin: '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/lib/wine/x86_64-unix/wine',
      name: 'CrossOver 26.1',
      type: 'crossover'
    }
    expect(isCrossOverRealBinary(realCx)).toBe(true)
  })

  it('returns false for the CrossOver Perl launcher script', () => {
    const scriptCx: WineInstallation = {
      bin: '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine',
      name: 'CrossOver 26.1',
      type: 'crossover'
    }
    expect(isCrossOverRealBinary(scriptCx)).toBe(false)
  })

  it('returns false for regular Wine', () => {
    const regular: WineInstallation = {
      bin: '/Users/segux/.kalimotxo/runtime/wine/Wine-11.0/bin/wine',
      name: 'Wine 11.0',
      type: 'wine'
    }
    expect(isCrossOverRealBinary(regular)).toBe(false)
  })
})

describe('setupWineEnvVars — CrossOver real binary mode', () => {
  it('sets WINEPREFIX (not CX_BOTTLE) when using real CrossOver binary', () => {
    const realCx: WineInstallation = {
      bin: '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/lib/wine/x86_64-unix/wine',
      name: 'CrossOver 26.1',
      type: 'crossover'
    }
    const env = setupWineEnvVars({}, realCx, {
      winePrefix: '/tmp/bottle',
      battleNetLaunch: true
    })
    expect(env.WINEPREFIX).toBe('/tmp/bottle')
    expect(env.CX_BOTTLE).toBeUndefined()
    expect(env.WINEARCH).toBe('win64')
  })

  it('sets CX_BOTTLE (not WINEPREFIX) when using CrossOver Perl launcher', () => {
    const scriptCx: WineInstallation = {
      bin: '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine',
      name: 'CrossOver 26.1',
      type: 'crossover'
    }
    const env = setupWineEnvVars({}, scriptCx, {
      winePrefix: '/tmp/bottle',
      crossoverBottle: 'Battle.net',
      battleNetLaunch: true
    })
    expect(env.CX_BOTTLE).toBe('Battle.net')
    expect(env.WINEPREFIX).toBeUndefined()
  })
})
