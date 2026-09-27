jest.mock('../../bottle', () => ({
  getBottleConfig: () => ({ env_vars: { WINEMSYNC: '1' } }),
  getBottlePath: (name: string) => `/tmp/bottles/${name}`
}))
jest.mock('../../launcher/wineRunner', () => ({
  getActiveWineInstallation: () => ({ bin: '/fake/wine/bin/wine', name: 'Wine 11', type: 'wine' })
}))

import { buildInstallerEnv, buildLibraryGameEnv } from '../gameEnv'

describe('buildLibraryGameEnv', () => {
  it('uses the bottle prefix and msync, without Battle.net client overrides', () => {
    const env = buildLibraryGameEnv('Games', 'dxmt')
    expect(env.WINEPREFIX).toBe('/tmp/bottles/Games')
    expect(env.WINEMSYNC).toBe('1')
    expect(env.WINEDLLOVERRIDES).toContain('d3d11=native')
    expect(env.WINEDLLOVERRIDES).toContain('dxgi=native')
    // Battle.net-only: would break .NET, installers and in-game video.
    expect(env.WINEDLLOVERRIDES).not.toMatch(/mscoree|mshtml|winegstreamer|mf=/)
    expect(env.WINE_HEAP_ZERO_MEMORY).toBeUndefined()
    expect(env.WINEDEBUG).toBe('fixme-all,err+module')
  })

  it('forces D3D12 builtin for D3DMetal and nothing for plain Wine D3D', () => {
    expect(buildLibraryGameEnv('Games', 'd3dmetal').WINEDLLOVERRIDES).toContain('d3d12=builtin')
    const wined3d = buildLibraryGameEnv('Games', 'wined3d')
    expect(wined3d.WINEDLLOVERRIDES).not.toContain('d3d11=builtin')
    expect(wined3d.CX_ACTIVE_GRAPHICS_BACKEND).toBeUndefined()
  })

  it('wined3d-gl selects the OpenGL renderer per process; wined3d keeps the bottle default', () => {
    expect(buildLibraryGameEnv('Games', 'wined3d-gl').WINE_D3D_CONFIG).toBe('renderer=gl')
    expect(buildLibraryGameEnv('Games', 'wined3d').WINE_D3D_CONFIG).toBeUndefined()
    expect(buildLibraryGameEnv('Games', 'wined3d-gl').CX_ACTIVE_GRAPHICS_BACKEND).toBeUndefined()
  })

  it('installer env has no graphics overrides', () => {
    const env = buildInstallerEnv('Games')
    expect(env.WINEDLLOVERRIDES ?? '').not.toContain('d3d11')
    expect(env.WINE_DISABLE_VA_ALLOC).toBeUndefined()
  })
})
