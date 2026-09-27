import { buildBattleNetLaunchEnv } from '../../../launcher/wineRunner'
import { setupWineEnvVars } from '../../../wine/wineEnv'
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
  })
}))

describe('buildBattleNetLaunchEnv', () => {
  it('aplica el stack «Battle.net ready» (D4Mac) en el cliente', () => {
    const env = buildBattleNetLaunchEnv('Battle.net')
    // esync y vars gráficas se eliminan para el cliente CEF.
    // WINEMSYNC se conserva: el wineserver debe correr con msync para que
    // los juegos hijos (D2R) hereden el modo de sincronización correcto.
    expect(env.WINEESYNC).toBeUndefined()
    expect(env.WINEMSYNC).toBe('1')
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

  it('enables WRITECOPY on CrossOver-source builds (Kalimotxo Wine)', () => {
    const env = setupWineEnvVars({}, cx, {
      winePrefix: '/tmp/bottle',
      battleNetLaunch: true
    })
    expect(env.WINE_SIMULATE_WRITECOPY).toBe('1')
  })
})
