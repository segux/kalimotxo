/** UI messages — no Wine/DLL jargon. */
const PHASE_LABEL: Record<string, string> = {
  idle: '',
  starting: 'Starting...',
  runtime: 'Preparing your Mac for Windows games...',
  deps: 'Installing Windows components...',
  bottle: 'Configuring Battle.net...',
  download: 'Downloading Battle.net...',
  installer: 'Opening Battle.net...',
  done: 'Ready',
  error: 'Something went wrong'
}

export function friendlyProgressMessage(phase: string, percent: number, _technical?: string): string {
  const label = PHASE_LABEL[phase] ?? 'Working...'
  if (phase === 'download' && percent > 0) {
    return `${label} ${percent}%`
  }
  if (percent > 0 && percent < 100 && phase !== 'idle') {
    return `${label} ${percent}%`
  }
  return label
}
