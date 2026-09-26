import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

jest.mock('../../config/paths', () => ({
  get DATA_DIR() {
    return global.__LIBRARY_TEST_DIR__
  }
}))

declare global {
  // eslint-disable-next-line no-var
  var __LIBRARY_TEST_DIR__: string
}

import {
  addLibraryGameRecord,
  getLibraryGame,
  loadLibrary,
  removeLibraryGameRecord,
  updateLibraryGameRecord
} from '../store'

beforeEach(() => {
  global.__LIBRARY_TEST_DIR__ = mkdtempSync(join(tmpdir(), 'library-'))
})

afterEach(() => {
  rmSync(global.__LIBRARY_TEST_DIR__, { recursive: true, force: true })
})

const base = { name: 'Game', exe: '/g/game.exe', bottle: 'Games', backend: 'dxmt' as const, args: [] }

describe('library store', () => {
  it('adds, updates and removes games', () => {
    expect(loadLibrary()).toEqual([])
    const game = addLibraryGameRecord(base)
    expect(game.id).toBeTruthy()
    expect(game.last_played).toBeNull()

    updateLibraryGameRecord(game.id, { name: 'Renamed', backend: 'wined3d' })
    expect(getLibraryGame(game.id)).toMatchObject({ name: 'Renamed', backend: 'wined3d' })

    expect(removeLibraryGameRecord(game.id)).toBe(true)
    expect(loadLibrary()).toEqual([])
    expect(removeLibraryGameRecord(game.id)).toBe(false)
  })

  it('does not add the same executable twice', () => {
    const a = addLibraryGameRecord(base)
    const b = addLibraryGameRecord({ ...base, name: 'Other' })
    expect(b.id).toBe(a.id)
    expect(loadLibrary()).toHaveLength(1)
  })
})
