/** winetricks/Wine log lines that add no value to the console (common macOS noise). */
const NOISE =
  /err:virtual:try_map_free_area|\[mvk-info\]|Autofill\.(enable|setAddresses)|taskset\/cpuset not available|possible \d+ extra bytes at end of file|GPU device:|Metal Shading Language|supports the following GPU|VK_KHR_|VK_EXT_|VK_AMD_|VK_MVK_|VK_GOOGLE_|VK_IMG_|VK_INTEL_|Created VkInstance/i

export function isWinetricksNoiseLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (NOISE.test(t)) return true
  if (t.startsWith('\t')) return true
  return false
}

export function filterWinetricksLogLine(line: string): string | null {
  return isWinetricksNoiseLine(line) ? null : line.trim()
}
