#!/usr/bin/env node
/** Downloads/copies bundled tools (winetricks, cabextract) at postinstall / predist time. */
import { existsSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

if (process.env.CI) {
  console.log('CI environment detected — skipping bundled tools sync')
  process.exit(0)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundledDir = join(root, 'resources', 'bundled')
mkdirSync(bundledDir, { recursive: true })

// ── winetricks ────────────────────────────────────────────────────────────────
const winetricksDest = join(bundledDir, 'winetricks')
const url = 'https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks'
const res = await fetch(url)
if (!res.ok) throw new Error(`winetricks download failed: ${res.status}`)
writeFileSync(winetricksDest, await res.text(), 'utf-8')
chmodSync(winetricksDest, 0o755)
console.log('Bundled winetricks →', winetricksDest)

// ── cabextract ────────────────────────────────────────────────────────────────
const toolsDir = join(bundledDir, 'tools')
const cabextractDest = join(toolsDir, 'cabextract')

if (!existsSync(cabextractDest)) {
  mkdirSync(toolsDir, { recursive: true })

  // Try to copy from Homebrew (arm64 or x86_64)
  const homebrewCandidates = ['/opt/homebrew/bin/cabextract', '/usr/local/bin/cabextract']
  let copied = false
  for (const src of homebrewCandidates) {
    if (existsSync(src)) {
      copyFileSync(src, cabextractDest)
      chmodSync(cabextractDest, 0o755)
      console.log(`Bundled cabextract from ${src} →`, cabextractDest)
      copied = true
      break
    }
  }

  if (!copied) {
    // Try system PATH
    try {
      const sys = execSync('which cabextract', { encoding: 'utf-8' }).trim()
      if (sys && existsSync(sys)) {
        copyFileSync(sys, cabextractDest)
        chmodSync(cabextractDest, 0o755)
        console.log(`Bundled cabextract from ${sys} →`, cabextractDest)
        copied = true
      }
    } catch { /* not in PATH */ }
  }

  if (!copied) {
    console.warn('cabextract not found — install via `brew install cabextract` before building the DMG')
  }
} else {
  console.log('cabextract already bundled →', cabextractDest)
}
