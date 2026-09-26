/** Graphics layer for a library game (see backend/library/gameEnv.ts). */
export type LibraryGraphicsBackend = 'dxmt' | 'd3dmetal' | 'wined3d'

/** A Windows game added by the user (not managed by a store launcher). */
export interface LibraryGame {
  id: string
  name: string
  /** Absolute macOS path to the game's .exe. */
  exe: string
  /** Wine bottle the game runs in. */
  bottle: string
  backend: LibraryGraphicsBackend
  args: string[]
  added_at: string
  last_played: string | null
}

/** Library entry as shown in the UI: user games plus Battle.net games. */
export interface LibraryEntry {
  id: string
  name: string
  source: 'local' | 'battlenet'
  backend: string
  running: boolean
  last_played: string | null
  /** Only for `local` entries. */
  game?: LibraryGame
}

export interface ExeCandidate {
  path: string
  /** Path relative to drive_c, for display. */
  label: string
  size: number
  suggested: boolean
}

export interface LibraryInstallProgress {
  phase: 'idle' | 'bottle' | 'deps' | 'installer' | 'scanning' | 'done' | 'error'
  message: string
}

export interface LibraryInstallResult {
  success: boolean
  /** The user cancelled the installer. */
  cancelled?: boolean
  message: string
  candidates: ExeCandidate[]
  /** Name suggested from the installer file name. */
  suggestedName: string
}

export interface AddLibraryGameInput {
  name: string
  exe: string
  backend?: LibraryGraphicsBackend
  args?: string[]
}

export interface UpdateLibraryGameInput {
  name?: string
  backend?: LibraryGraphicsBackend
  args?: string[]
}
