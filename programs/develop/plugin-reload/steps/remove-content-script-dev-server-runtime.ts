// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

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

function isDevServerModule(moduleBody: string): boolean {
  const strongHit = DEV_SERVER_STRONG_MARKERS.some((marker) =>
    moduleBody.includes(marker)
  )
  const weakHits = DEV_SERVER_WEAK_MARKERS.filter((marker) =>
    moduleBody.includes(marker)
  ).length

  return strongHit || weakHits >= 2
}

// The startup modules a bundle still requires that are dev-server runtime.
function devServerStartupModuleIds(source: string): string[] {
  return getStartupModuleIds(source).filter((moduleId) => {
    const moduleBody = getModuleBody(source, moduleId)

    return moduleBody !== null && isDevServerModule(moduleBody)
  })
}

// Only a client the bundle still starts can open a connection. Its module
// text alone stays behind after a strip, and user code may name it.
export function contentScriptRetainsDevServerRuntime(source: string): boolean {
  return devServerStartupModuleIds(source).length > 0
}

export interface StrippedContentScript {
  source: string
  // Start and end offsets in the input of each piece taken out, in order.
  removed: Array<[number, number]>
}

export function stripDevServerStartup(source: string): StrippedContentScript {
  const removed: Array<[number, number]> = []

  // Strip ONLY modules identified as dev-server runtime by content, never by
  // startup position; a positional sweep deletes the user's script.
  for (const moduleId of devServerStartupModuleIds(source)) {
    const match = startupRequirePattern(moduleId).exec(source)
    if (match) removed.push([match.index, match.index + match[0].length])
  }

  removed.sort((a, b) => a[0] - b[0])

  let nextSource = ''
  let from = 0

  for (const [start, end] of removed) {
    nextSource += source.slice(from, start)
    from = end
  }

  return {source: nextSource + source.slice(from), removed}
}

export function stripDevServerStartupFromContentScript(source: string): string {
  return stripDevServerStartup(source).source
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

function startupRequirePattern(moduleId: string): RegExp {
  return new RegExp(`^[ \\t]*__webpack_require__\\(${moduleId}\\);\\n?`, 'm')
}
