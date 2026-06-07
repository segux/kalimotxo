export const BATTLENET_BOTTLE = 'Battle.net'
export const INSTALLER_URL =
  'https://downloader.battle.net/download/getInstallerForGame?os=win&gameProgram=BATTLENET_APP&version=Live'
export const INSTALLER_NAME = 'Battle.net-Setup.exe'
export const BATTLENET_LAUNCHER_BACKEND = 'wined3d'

export const MAIN_EXE_REL_PATHS = [
  'Program Files (x86)/Battle.net/Battle.net.exe',
  'Program Files/Battle.net/Battle.net.exe'
]

export const LAUNCHER_REL_PATHS = [
  'Program Files (x86)/Battle.net/Battle.net Launcher.exe',
  'Program Files/Battle.net/Battle.net Launcher.exe'
]

/** VC++ / UCRT runtime required for Battle.net (vcrun2022 replaces vcrun2019 in recent Wine). */
export const BATTLENET_DEPS = ['vcrun2022', 'd3dcompiler_47', 'ucrtbase2019']
export const BATTLENET_DEPS_QUICK = ['vcrun2022', 'd3dcompiler_47', 'ucrtbase2019']
export const BATTLENET_LAUNCH_PREP = ['vcrun2022', 'ucrtbase2019', 'mf']
/** Only when the user requests a full font repair (slow and noisy on macOS). */
export const BATTLENET_DEPS_OPTIONAL = ['corefonts', 'vcrun2019'] as const

export const SYSWOW64_VC_DLLS = [
  'msvcp140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'msvcp140_1.dll'
]

export const SYSWOW64_UCRT_API_MS = [
  'api-ms-win-crt-private-l1-1-0.dll',
  'api-ms-win-crt-conio-l1-1-0.dll',
  'api-ms-win-crt-convert-l1-1-0.dll',
  'api-ms-win-crt-environment-l1-1-0.dll',
  'api-ms-win-crt-filesystem-l1-1-0.dll',
  'api-ms-win-crt-heap-l1-1-0.dll',
  'api-ms-win-crt-locale-l1-1-0.dll',
  'api-ms-win-crt-math-l1-1-0.dll',
  'api-ms-win-crt-multibyte-l1-1-0.dll',
  'api-ms-win-crt-process-l1-1-0.dll',
  'api-ms-win-crt-runtime-l1-1-0.dll',
  'api-ms-win-crt-stdio-l1-1-0.dll',
  'api-ms-win-crt-string-l1-1-0.dll',
  'api-ms-win-crt-time-l1-1-0.dll',
  'api-ms-win-crt-utility-l1-1-0.dll'
]

export const SYSWOW64_UCRT_SENTINELS = [
  'api-ms-win-crt-runtime-l1-1-0.dll',
  'api-ms-win-crt-private-l1-1-0.dll'
]

export const UCRT_DLL_OVERRIDE_NAMES = [
  ...SYSWOW64_UCRT_API_MS.map((n) => n.replace(/\.dll$/, '')),
  'ucrtbase'
]

export const MIN_CLIENT_BYTES = 120 * 1024 * 1024
