// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export type ModuleId = string | number

// The packages whose files are the client a dev server starts in a page:
// its socket client and the hot update runtime that runs beside it.
const DEV_CLIENT_FOLDERS = [
  '@rspack/dev-server/client/',
  '@rspack/core/hot/',
  'webpack-dev-server/client/',
  'webpack/hot/'
]

// A module is the dev client by the file it was read from, never by its
// text: a content script may quote the client's own log lines.
export function isDevServerClientFile(file: string | undefined): boolean {
  const posix = String(file || '')
    .split('?')[0]
    .replace(/\\/g, '/')

  return DEV_CLIENT_FOLDERS.some((folder) =>
    posix.includes(`/node_modules/${folder}`)
  )
}

// The startup line of a module as the bundle writes it: a number bare, a
// name as a string literal.
function startupStatement(moduleId: ModuleId): string {
  const written =
    typeof moduleId === 'number' ? String(moduleId) : JSON.stringify(moduleId)

  return `__webpack_require__(${written});`
}

// Where the line that only starts this module begins and ends, newline
// included, at or after `from`.
function startupLine(
  source: string,
  from: number,
  moduleId: ModuleId
): [number, number] | undefined {
  const statement = startupStatement(moduleId)

  for (
    let at = source.indexOf(statement, from);
    at !== -1;
    at = source.indexOf(statement, at + 1)
  ) {
    let start = at

    while (
      start > 0 &&
      (source[start - 1] === ' ' || source[start - 1] === '\t')
    ) {
      start -= 1
    }

    const end = at + statement.length
    const opensLine = start === 0 || source[start - 1] === '\n'
    const closesLine = end === source.length || source[end] === '\n'

    if (opensLine && closesLine) {
      return [start, Math.min(end + 1, source.length)]
    }
  }

  return undefined
}

interface StrippedContentScript {
  source: string
  // Start and end offsets in the input of each piece taken out, in order.
  removed: Array<[number, number]>
  // The ids whose start was not found as a line of its own. Each of them
  // still starts, in line or in a form this step does not read.
  kept: ModuleId[]
}

// Takes out the startup line of each entry module of the client, by its id
// alone. A module is never judged by where it sits or what it says.
export function stripDevServerStartup(
  source: string,
  clientEntryIds: readonly ModuleId[]
): StrippedContentScript {
  const removed: Array<[number, number]> = []
  const kept: ModuleId[] = []
  const startupIndex = source.indexOf('// startup')

  for (const moduleId of clientEntryIds) {
    const line =
      startupIndex === -1
        ? undefined
        : startupLine(source, startupIndex, moduleId)

    if (line) removed.push(line)
    else kept.push(moduleId)
  }

  removed.sort((a, b) => a[0] - b[0])

  let nextSource = ''
  let from = 0

  for (const [start, end] of removed) {
    nextSource += source.slice(from, start)
    from = end
  }

  return {source: nextSource + source.slice(from), removed, kept}
}
