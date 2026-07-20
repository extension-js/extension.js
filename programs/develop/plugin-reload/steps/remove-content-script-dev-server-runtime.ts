// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Strings that identify a startup module as dev-server runtime on their own.
// Each is specific enough that user code containing it would be pathological.
const DEV_SERVER_STRONG_MARKERS = [
  '@rspack/dev-server/client/index.js?',
  '@rspack/dev-server/client/utils/ansiHTML.js',
  '[HMR] Waiting for update signal from WDS...'
]
// Weak markers also occur in user code; one hit alone must NOT strip the
// module, so weak markers only count when at least two co-occur.
const DEV_SERVER_WEAK_MARKERS = [
  'webpack-dev-server',
  'WebSocketClient',
  '.hot.check()',
  '[HMR] Cannot find update. Need to do a full reload!'
]

export function contentScriptRetainsDevServerRuntime(source: string): boolean {
  return source.includes('@rspack/dev-server/client')
}

export function stripDevServerStartupFromContentScript(source: string): string {
  let nextSource = source
  const startupModuleIds = getStartupModuleIds(source)

  for (const moduleId of startupModuleIds) {
    const moduleBody = getModuleBody(source, moduleId)
    if (!moduleBody) continue

    // Strip ONLY modules identified as dev-server runtime by content, never by
    // startup position; a positional sweep deletes the user's script.
    const strongHit = DEV_SERVER_STRONG_MARKERS.some((marker) =>
      moduleBody.includes(marker)
    )
    const weakHits = DEV_SERVER_WEAK_MARKERS.filter((marker) =>
      moduleBody.includes(marker)
    ).length

    if (strongHit || weakHits >= 2) {
      nextSource = stripStartupRequire(nextSource, moduleId)
    }
  }

  return nextSource
}

function getStartupModuleIds(source: string): string[] {
  const startupIndex = source.indexOf('// startup')
  if (startupIndex === -1) return []

  const startupSection = source.slice(startupIndex)
  const requirePattern = /__webpack_require__\((\d+)\);/g
  const ids: string[] = []
  let match: RegExpExecArray | null = null

  while ((match = requirePattern.exec(startupSection))) {
    ids.push(match[1])
  }

  return ids
}

function getModuleBody(source: string, moduleId: string): string | null {
  const moduleHeaderPattern = new RegExp(
    `(?:^|\\n)${moduleId}\\([^)]*\\)\\s*\\{`,
    'm'
  )
  const headerMatch = moduleHeaderPattern.exec(source)
  if (!headerMatch) return null

  const moduleStart = headerMatch.index
  const nextHeaderPattern = /(?:^|\n)\d+\([^)]*\)\s*\{/g

  nextHeaderPattern.lastIndex = moduleStart + headerMatch[0].length
  const nextHeaderMatch = nextHeaderPattern.exec(source)

  return source.slice(
    moduleStart,
    nextHeaderMatch ? nextHeaderMatch.index : source.length
  )
}

function stripStartupRequire(source: string, moduleId: string): string {
  const startupRequirePattern = new RegExp(
    `^\\s*__webpack_require__\\(${moduleId}\\);\\n?`,
    'm'
  )

  return source.replace(startupRequirePattern, '')
}
