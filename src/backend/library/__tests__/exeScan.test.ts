import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  detectGraphicsBackend,
  nameFromInstaller,
  rankExeCandidates,
  snapshotExes
} from '../exeScan'

let driveC: string

beforeEach(() => {
  driveC = mkdtempSync(join(tmpdir(), 'exe-scan-'))
})

afterEach(() => {
  rmSync(driveC, { recursive: true, force: true })
})

function put(rel: string, content: string | Buffer): string {
  const p = join(driveC, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content)
  return p
}

describe('snapshotExes + rankExeCandidates', () => {
  it('returns only the executables the installer added, game first', () => {
    put('windows/system32/notepad.exe', 'x')
    put('Program Files/Old/old.exe', 'x')
    const before = snapshotExes(driveC)

    put('GOG Games/Cool Game/unins000.exe', Buffer.alloc(5_000_000))
    put('GOG Games/Cool Game/CoolGame.exe', Buffer.alloc(3_000_000))
    put('GOG Games/Cool Game/tools/editor.exe', Buffer.alloc(1_000_000))
    put('GOG Games/Cool Game/_redist/vc_redist.x64.exe', Buffer.alloc(9_000_000))
    const after = snapshotExes(driveC)

    expect([...after.keys()].some((p) => p.includes('windows'))).toBe(false)
    const ranked = rankExeCandidates(before, after, driveC)
    expect(ranked.map((c) => c.label)).toEqual([
      join('GOG Games', 'Cool Game', 'CoolGame.exe'),
      join('GOG Games', 'Cool Game', 'tools', 'editor.exe'),
      join('GOG Games', 'Cool Game', '_redist', 'vc_redist.x64.exe'),
      join('GOG Games', 'Cool Game', 'unins000.exe')
    ])
    expect(ranked[0]!.suggested).toBe(true)
    expect(ranked.filter((c) => c.suggested)).toHaveLength(1)
  })

  it('suggests nothing when only helpers were added', () => {
    const before = snapshotExes(driveC)
    put('Game/unins000.exe', 'x')
    const ranked = rankExeCandidates(before, snapshotExes(driveC), driveC)
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.suggested).toBe(false)
  })
})

describe('detectGraphicsBackend', () => {
  it.each([
    ['D3D12.dll KERNEL32.dll', 'd3dmetal'],
    ['d3d11.dll dxgi.dll', 'dxmt'],
    ['d3d9.dll user32.dll', 'wined3d'],
    ['OPENGL32.dll', 'wined3d'],
    ['kernel32.dll only', 'dxmt']
  ])('%s -> %s', (imports, expected) => {
    const exe = put('Game/game.exe', `MZ....${imports}....`)
    expect(detectGraphicsBackend(exe)).toBe(expected)
  })
})

describe('nameFromInstaller', () => {
  it.each([
    ['setup_cool_game_1.2.3_(64bit)_(12345).exe', 'cool game'],
    ['Some Game Installer.exe', 'Some Game'],
    ['MyGame-Setup.msi', 'MyGame']
  ])('%s -> %s', (file, expected) => {
    expect(nameFromInstaller(`/tmp/${file}`)).toBe(expected)
  })
})
