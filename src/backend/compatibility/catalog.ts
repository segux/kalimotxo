import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

import { getBottlePath } from '../bottle'

export type GameProfile = {
  name: string
  publisher?: string
  exe: string
  backend: string
  sync: string
  windows_version: string
  env: Record<string, string>
  deps: string[]
  dll_overrides: Record<string, string>
  args?: string[]
  notes?: string
  rating?: number
}

let cache: Record<string, GameProfile> | null = null

function catalogPath(): string {
  const candidates = [
    join(process.cwd(), 'data', 'compatibility.json'),
    join(app.getAppPath(), 'data', 'compatibility.json')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]!
}

export function loadGameCatalog(): Record<string, GameProfile> {
  if (cache) return cache
  const raw = readFileSync(catalogPath(), 'utf-8')
  cache = JSON.parse(raw) as Record<string, GameProfile>
  return cache
}

export function getGameProfile(id: string): GameProfile | null {
  return loadGameCatalog()[id] ?? null
}

export function resolveGameExe(
  bottleName: string,
  profileId: string
): string | null {
  const profile = getGameProfile(profileId)
  if (!profile) return null
  const p = join(getBottlePath(bottleName), 'drive_c', profile.exe)
  return existsSync(p) ? p : null
}

export const BLIZZARD_GAME_IDS = [
  'diablo2r',
  'diablo4',
  'wow',
  'overwatch2',
  'hearthstone',
  'starcraft2'
] as const

export type BlizzardGameId = (typeof BLIZZARD_GAME_IDS)[number]
