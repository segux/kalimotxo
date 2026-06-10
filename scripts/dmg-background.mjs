#!/usr/bin/env node
/**
 * Generates build/dmg-background.png for the macOS DMG installer.
 * Dark background with Kalimotxo logo + Applications folder arrow.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const logoPath = join(root, 'public/brand/kalimotxo-icon.png')
const outPath = join(buildDir, 'dmg-background.png')

// DMG window size (standard macOS)
const W = 658
const H = 498

// Background: dark gradient (macOS-style)
const bgSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="50%" stop-color="#16213e"/>
      <stop offset="100%" stop-color="#0f3460"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
</svg>`

async function main() {
  mkdirSync(buildDir, { recursive: true })

  // Step 1: render background gradient
  const bgBuffer = await sharp(Buffer.from(bgSvg)).png().toBuffer()

  // Step 2: resize logo to ~180px for the DMG window
  const logoBuffer = await sharp(logoPath)
    .resize(180, 180, { fit: 'contain' })
    .png()
    .toBuffer()

  // Step 3: create arrow SVG pointing right to Applications folder
  const arrowSvg = `<svg width="120" height="120" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 55 L80 55 L80 35 L110 60 L80 85 L80 65 L10 65 Z" fill="#e94560" opacity="0.9"/>
  </svg>`

  const arrowBuffer = await sharp(Buffer.from(arrowSvg)).png().toBuffer()

  // Step 4: compose everything onto the background
  // Logo: left side, vertically centered
  const logoLeft = 120
  const logoTop = Math.floor((H - 180) / 2)

  // Arrow: right side, horizontally centered near where Applications folder would be
  const arrowLeft = 420
  const arrowTop = Math.floor((H - 120) / 2)

  const finalBuffer = await sharp(bgBuffer)
    .composite([
      { input: logoBuffer, top: logoTop, left: logoLeft },
      { input: arrowBuffer, top: arrowTop, left: arrowLeft }
    ])
    .png()
    .toBuffer()

  writeFileSync(outPath, finalBuffer)
  console.log(`Wrote ${outPath} (${finalBuffer.length} bytes)`)
}

main().catch((err) => {
  console.error('DMG background generation failed:', err)
  process.exit(1)
})
