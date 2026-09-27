import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const ROOT = join(tmpdir(), 'kalimotxo-d3dmetal-dx12-jest')

jest.mock('../../config/paths', () => ({
  ...jest.requireActual('../../config/paths'),
  D3DMETAL_DIR: join(tmpdir(), 'kalimotxo-d3dmetal-dx12-jest', 'd3dmetal')
}))
jest.mock('../../config/bundled', () => ({
  getBundledDir: () => join(tmpdir(), 'kalimotxo-d3dmetal-dx12-jest', 'bundled')
}))
jest.mock('../d3dmetalSetup', () => ({
  isD3dmetalDx12Ready: () => true
}))

import { usesAppleD3dmetal } from '../../compatibility/catalog'
import {
  ensureD3dmetalDx12ForExe,
  installD3dmetalDx12Builtins,
  installD3dmetalDx12NextToExe
} from '../d3dmetalDx12'

describe('usesAppleD3dmetal', () => {
  it('covers CrossOver builtins and the GPTK DX12 per-exe path', () => {
    expect(usesAppleD3dmetal('d3dmetal')).toBe(true)
    expect(usesAppleD3dmetal('d3dmetal-dx12')).toBe(true)
    expect(usesAppleD3dmetal('dxmt')).toBe(false)
  })
})

describe('d3dmetalDx12', () => {
  const d3dmetal = join(ROOT, 'd3dmetal')
  const bundled = join(ROOT, 'bundled', 'd3dmetal-forwarders')
  const wine = join(ROOT, 'wine')
  const unix = join(wine, 'lib', 'wine', 'x86_64-unix')
  const windows = join(wine, 'lib', 'wine', 'x86_64-windows')

  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(join(d3dmetal, 'dx12', 'x86_64-windows'), { recursive: true })
    mkdirSync(join(d3dmetal, 'dx12', 'x86_64-unix'), { recursive: true })
    mkdirSync(unix, { recursive: true })
    mkdirSync(windows, { recursive: true })
    mkdirSync(bundled, { recursive: true })
    writeFileSync(join(d3dmetal, 'libd3dshared.dylib'), 'shared')
    writeFileSync(join(d3dmetal, 'dx12', 'x86_64-windows', 'd3d12.dll'), 'gptk-d3d12')
    writeFileSync(join(d3dmetal, 'dx12', 'x86_64-windows', 'dxgi.dll'), 'gptk-dxgi')
    writeFileSync(join(bundled, 'd3d12.dll'), 'fwd-d3d12')
    writeFileSync(join(bundled, 'dxgi.dll'), 'fwd-dxgi')
  })

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('renames GPTK builtins and points both unix .so files at one libd3dshared', () => {
    expect(installD3dmetalDx12Builtins(wine).sort()).toEqual([
      'x86_64-unix/d3d12_d3dmetal.so',
      'x86_64-unix/dxgi_d3dmetal.so',
      'x86_64-unix/libd3dshared.dylib',
      'x86_64-windows/d3d12_d3dmetal.dll',
      'x86_64-windows/dxgi_d3dmetal.dll'
    ])
    expect(readFileSync(join(windows, 'd3d12_d3dmetal.dll'), 'utf-8')).toBe('gptk-d3d12')
    expect(lstatSync(join(unix, 'd3d12_d3dmetal.so')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(unix, 'd3d12_d3dmetal.so'))).toBe('libd3dshared.dylib')
    expect(readlinkSync(join(unix, 'dxgi_d3dmetal.so'))).toBe('libd3dshared.dylib')
    expect(installD3dmetalDx12Builtins(wine)).toEqual([])
  })

  it('copies the forwarders next to the game exe', () => {
    const game = join(ROOT, 'game')
    mkdirSync(game)
    const exe = join(game, 'D2R.exe')
    writeFileSync(exe, '')
    expect(installD3dmetalDx12NextToExe(exe).sort()).toEqual(['d3d12.dll', 'dxgi.dll'])
    expect(readFileSync(join(game, 'd3d12.dll'), 'utf-8')).toBe('fwd-d3d12')
    expect(installD3dmetalDx12NextToExe(exe)).toEqual([])
  })

  it('installs both sides for a Wine layout next to bin/wine', () => {
    mkdirSync(join(wine, 'bin'), { recursive: true })
    const exe = join(ROOT, 'game', 'D2R.exe')
    mkdirSync(join(ROOT, 'game'))
    writeFileSync(exe, '')
    expect(
      ensureD3dmetalDx12ForExe({ bin: join(wine, 'bin', 'wine') } as never, exe)
    ).toBe(true)
    expect(existsSync(join(windows, 'd3d12_d3dmetal.dll'))).toBe(true)
    expect(existsSync(join(ROOT, 'game', 'dxgi.dll'))).toBe(true)
  })
})
