import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

jest.mock('../../../bottle', () => ({
  getBottlePath: (name: string) => join(global.__GAME_DEFAULTS_ROOT__, name)
}))
jest.mock('../../../launcher/wineRunner', () => ({
  buildEnv: () => ({}),
  getWineBinary: () => '/fake/wine'
}))
jest.mock('../../../compatibility/catalog', () => {
  const { existsSync } = require('fs')
  const { join } = require('path')
  const profiles: Record<string, unknown> = {
    diablo2r: {
      name: 'Diablo II: Resurrected',
      exe: 'Program Files (x86)/Diablo II Resurrected/D2R.exe',
      bnet_product: 'osi',
      backend: 'dxmt',
      sync: 'msync',
      windows_version: 'win10',
      env: {},
      deps: [],
      dll_overrides: { d3d11: 'native', winegstreamer: '', crypt32: 'builtin' },
      args: ['-dx11']
    }
  }
  return {
    BLIZZARD_GAME_IDS: ['diablo2r'],
    getGameProfile: (id: string) => profiles[id] ?? null,
    resolveGameExe: (bottle: string, id: string) => {
      const p = join(global.__GAME_DEFAULTS_ROOT__, bottle, 'drive_c', (profiles[id] as { exe: string }).exe)
      return existsSync(p) ? p : null
    }
  }
})

declare global {
  // eslint-disable-next-line no-var
  var __GAME_DEFAULTS_ROOT__: string
}

import { applyBattleNetLaunchArgs, buildGameAppDefaultsReg } from '../gameDefaults'
import type { GameProfile } from '../../../compatibility/catalog'

const BOTTLE = 'Battle.net'

function installD2R(): void {
  const dir = join(global.__GAME_DEFAULTS_ROOT__, BOTTLE, 'drive_c', 'Program Files (x86)', 'Diablo II Resurrected')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'D2R.exe'), '')
}

function configPath(): string {
  return join(global.__GAME_DEFAULTS_ROOT__, BOTTLE, 'drive_c', 'users', 'me', 'AppData', 'Roaming', 'Battle.net', 'Battle.net.config')
}

function writeConfig(cfg: unknown): void {
  mkdirSync(join(configPath(), '..'), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(cfg, null, 4))
}

beforeEach(() => {
  global.__GAME_DEFAULTS_ROOT__ = mkdtempSync(join(tmpdir(), 'game-defaults-'))
})

afterEach(() => {
  rmSync(global.__GAME_DEFAULTS_ROOT__, { recursive: true, force: true })
})

describe('buildGameAppDefaultsReg', () => {
  it('keeps d3d12/dxgi native for the D3DMetal DX12 per-exe path', () => {
    const reg = buildGameAppDefaultsReg([
      {
        exe: 'Program Files (x86)/Diablo II Resurrected/D2R.exe',
        backend: 'd3dmetal-dx12',
        dll_overrides: { d3d12: 'native', dxgi: 'native', crypt32: 'builtin' }
      } as unknown as GameProfile
    ])
    expect(reg).toContain('"d3d12"="native"')
    expect(reg).toContain('"dxgi"="native"')
    expect(reg).toContain('"crypt32"="builtin"')
  })

  it('writes per-exe overrides, loading DXMT native from the game folder', () => {
    const reg = buildGameAppDefaultsReg([
      {
        exe: 'Program Files (x86)/Diablo II Resurrected/D2R.exe',
        backend: 'dxmt',
        dll_overrides: { d3d11: 'native', winegstreamer: '', crypt32: 'builtin' }
      } as unknown as GameProfile
    ])
    expect(reg).toContain('[HKEY_CURRENT_USER\\Software\\Wine\\AppDefaults\\D2R.exe\\DllOverrides]')
    expect(reg).toContain('"d3d11"="native"')
    expect(reg).toContain('"dxgi"="native"')
    expect(reg).toContain('"d3d10core"="native"')
    expect(reg).toContain('"winegstreamer"=""')
    expect(reg).toContain('"crypt32"="builtin"')
  })

  it('returns nothing when no profile has overrides', () => {
    expect(buildGameAppDefaultsReg([{ exe: 'a.exe', backend: 'wined3d', dll_overrides: {} } as unknown as GameProfile])).toBe('')
  })
})

describe('applyBattleNetLaunchArgs', () => {
  it('adds the profile args for installed games, keeping other settings', () => {
    installD2R()
    writeConfig({ Client: { HardwareAcceleration: 'false' } })

    expect(applyBattleNetLaunchArgs(BOTTLE)).toHaveLength(1)
    const cfg = JSON.parse(readFileSync(configPath(), 'utf-8'))
    expect(cfg.Games.osi.AdditionalLaunchArguments).toBe('-dx11')
    expect(cfg.Client.HardwareAcceleration).toBe('false')
  })

  it('never overrides arguments the user set', () => {
    installD2R()
    writeConfig({ Games: { osi: { AdditionalLaunchArguments: '-mine' } } })

    expect(applyBattleNetLaunchArgs(BOTTLE)).toHaveLength(0)
    const cfg = JSON.parse(readFileSync(configPath(), 'utf-8'))
    expect(cfg.Games.osi.AdditionalLaunchArguments).toBe('-mine')
  })

  it('does nothing when the game is not installed', () => {
    writeConfig({})
    expect(applyBattleNetLaunchArgs(BOTTLE)).toHaveLength(0)
  })
})
