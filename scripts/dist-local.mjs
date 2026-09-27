#!/usr/bin/env node
/**
 * Local test build: packages Kalimotxo.app with a version that says where it
 * comes from (e.g. 0.3.3-local.f163105, `.dirty` with uncommitted changes), so
 * it can be told apart from a release in About Kalimotxo.
 *
 *   pnpm run dist:local              -> dist/local/mac-arm64/Kalimotxo.app
 *   pnpm run dist:local -- --install -> replaces /Applications/Kalimotxo.app
 *
 * --install quits the running Kalimotxo first and removes the intermediate copy
 * afterwards, so macOS never sees two apps with the same bundle id.
 * Nothing is published; releases only come from main (see CONTRIBUTING.md).
 */
import { execSync } from 'child_process'
import { existsSync, readFileSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' })
const out = (cmd) => execSync(cmd, { cwd: root }).toString().trim()

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const sha = out('git rev-parse --short HEAD')
const dirty = out('git status --porcelain') ? '.dirty' : ''
const version = `${pkg.version}-local.${sha}${dirty}`
const outputDir = join(root, 'dist', 'local')
const builtApp = join(outputDir, 'mac-arm64', 'Kalimotxo.app')
const installedApp = '/Applications/Kalimotxo.app'
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

console.log(`==> Building Kalimotxo ${version}`)
rmSync(outputDir, { recursive: true, force: true })
run('node scripts/export-app-icon.mjs')
run('node scripts/dmg-background.mjs')
run('node scripts/sync-bundled-tools.mjs')
run('pnpm exec electron-vite build')
run(
  `pnpm exec electron-builder --mac dir --publish=never ` +
    `-c.extraMetadata.version=${version} -c.directories.output=dist/local`
)
if (!existsSync(builtApp)) throw new Error(`Build output not found: ${builtApp}`)

if (!process.argv.includes('--install')) {
  console.log(`\nBuilt ${builtApp}\nInstall it with: pnpm run dist:local -- --install`)
  process.exit(0)
}

console.log('==> Installing into /Applications')
try {
  execSync(`osascript -e 'quit app "${installedApp}"'`, { stdio: 'ignore' })
} catch {
  /* not running */
}
execSync('sleep 2')
rmSync(installedApp, { recursive: true, force: true })
run(`ditto "${builtApp}" "${installedApp}"`)
execSync(`"${LSREGISTER}" -u "${builtApp}"`, { stdio: 'ignore' })
rmSync(outputDir, { recursive: true, force: true })
console.log(`\nInstalled Kalimotxo ${version} in ${installedApp}`)
