import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { dirname, join } from 'path'

import { DATA_DIR } from '../config/paths'
import type { LibraryGame } from '../../common/types/library'

/** User-added games live in `~/.kalimotxo/library.json`. */
export function libraryPath(): string {
  return join(DATA_DIR, 'library.json')
}

type LibraryFile = { version: 1; games: LibraryGame[] }

export function loadLibrary(): LibraryGame[] {
  const path = libraryPath()
  if (!existsSync(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LibraryFile>
    return Array.isArray(data.games) ? data.games : []
  } catch {
    return []
  }
}

function saveLibrary(games: LibraryGame[]): void {
  const path = libraryPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  const data: LibraryFile = { version: 1, games }
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  renameSync(tmp, path)
}

export function getLibraryGame(id: string): LibraryGame | null {
  return loadLibrary().find((g) => g.id === id) ?? null
}

export function addLibraryGameRecord(
  game: Omit<LibraryGame, 'id' | 'added_at' | 'last_played'>
): LibraryGame {
  const games = loadLibrary()
  const existing = games.find((g) => g.exe === game.exe)
  if (existing) return existing
  const record: LibraryGame = {
    ...game,
    id: randomUUID(),
    added_at: new Date().toISOString(),
    last_played: null
  }
  saveLibrary([...games, record])
  return record
}

export function updateLibraryGameRecord(
  id: string,
  patch: Partial<Omit<LibraryGame, 'id'>>
): LibraryGame | null {
  const games = loadLibrary()
  const idx = games.findIndex((g) => g.id === id)
  if (idx === -1) return null
  const updated = { ...games[idx]!, ...patch, id }
  games[idx] = updated
  saveLibrary(games)
  return updated
}

export function removeLibraryGameRecord(id: string): boolean {
  const games = loadLibrary()
  const next = games.filter((g) => g.id !== id)
  if (next.length === games.length) return false
  saveLibrary(next)
  return true
}
