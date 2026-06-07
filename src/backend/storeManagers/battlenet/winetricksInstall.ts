import { getBottleConfig } from '../../bottle'
import { stopWineForWinetricks } from '../../launcher/wineRunner'
import { installDep } from '../../tools/winetricks'

export function shouldSkipWinetricksVerb(verb: string, installed: Set<string>): boolean {
  if (installed.has(verb)) return true
  if (verb === 'vcrun2019' && installed.has('vcrun2022')) return true
  return false
}

/** Known winetricks failures that do not prevent launching Battle.net. */
export function isRecoverableWinetricksFailure(verb: string, ok: boolean, output: string): boolean {
  if (ok) return false
  if (verb === 'mf') return true
  if (verb === 'vcrun2019') {
    if (/status 102|returned status 102/i.test(output)) return true
    if (/vcrun2022/i.test(output)) return true
  }
  return false
}

export async function installBattlenetVerbs(
  bottleName: string,
  verbs: readonly string[],
  log: (m: string) => void,
  options?: { force?: boolean }
): Promise<[boolean, string]> {
  stopWineForWinetricks(bottleName)
  let installed = new Set<string>()
  try {
    installed = new Set(getBottleConfig(bottleName).installed_deps)
  } catch {
    /* new bottle */
  }

  for (const verb of verbs) {
    if (shouldSkipWinetricksVerb(verb, installed)) {
      log(`  ○ ${verb} (ya instalado u obsoleto)`)
      continue
    }
    log(`  → ${verb}…`)
    const [ok, out] = await installDep(bottleName, verb, log, {
      force: options?.force
    })
    if (!ok && isRecoverableWinetricksFailure(verb, ok, out)) {
      log(`  ○ ${verb} (omitido: ${out.split('\n').find((l) => /warning|status|Aborting/i.test(l))?.slice(0, 120) ?? 'sin impacto en runtime'})`)
      continue
    }
    if (!ok) return [false, `Failed ${verb}: ${out.slice(0, 400)}`]
    installed.add(verb)
  }
  return [true, 'Winetricks dependencies applied']
}
