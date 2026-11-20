// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {
  BrowserConfig,
  BuildOptions,
  DevOptions,
  FileConfig,
  PreviewOptions,
  StartOptions
} from '../types'

type CommandBlocks = NonNullable<FileConfig['commands']>

// A list that tsc holds to exactly the keys of T: a key added to the type and
// left off the list, or a list entry the type lacks, fails the compile.
function keysOf<T>() {
  return <const L extends readonly string[]>(
    list: L &
      ([Exclude<keyof T, L[number]>] extends [never]
        ? unknown
        : {listLacks: Exclude<keyof T, L[number]>}) &
      ([Exclude<L[number], keyof T>] extends [never]
        ? unknown
        : {typeLacks: Exclude<L[number], keyof T>})
  ): readonly string[] => list
}

// Each commands block is merged under the command's own options, so a key is
// read when the block's type or the command's options have it.
const COMMAND_KEYS: Record<keyof CommandBlocks, readonly string[]> = {
  dev: keysOf<NonNullable<CommandBlocks['dev']> & Omit<DevOptions, 'mode'>>()([
    'allowControl',
    'allowEval',
    'allowedHosts',
    'appIcon',
    'appName',
    'browser',
    'browserFlags',
    'bundleId',
    'chromiumBinary',
    'copyFromProfile',
    'define',
    'developmentTeam',
    'exclude',
    'excludeBrowserFlags',
    'exitOnError',
    'extensions',
    'firefoxBinary',
    'folders',
    'forceRegenerate',
    'geckoBinary',
    'hashContentScripts',
    'hintFor',
    'host',
    'include',
    'install',
    'keepProfileChanges',
    'logColor',
    'logContexts',
    'logFormat',
    'logLevel',
    'logTab',
    'logTimestamps',
    'logUrl',
    'macOsOnly',
    'noBrowser',
    'noOpen',
    'perfBudgets',
    'persistProfile',
    'polyfill',
    'port',
    'preferences',
    'profile',
    'publicHost',
    'safariBinary',
    'safariPackager',
    'startingUrl',
    'transpilePackages'
  ]),
  build: keysOf<NonNullable<CommandBlocks['build']> & BuildOptions>()([
    'addonLint',
    'appIcon',
    'appName',
    'browser',
    'bundleId',
    'chromiumBinary',
    'define',
    'developmentTeam',
    'exclude',
    'exitOnError',
    'extensions',
    'failOnWarning',
    'firefoxBinary',
    'folders',
    'forceRegenerate',
    'geckoBinary',
    'include',
    'install',
    'launchFollows',
    'macOsOnly',
    'metadataCommand',
    'minify',
    'mode',
    'outDir',
    'perfBudgets',
    'polyfill',
    'safariBinary',
    'safariPackager',
    'silent',
    'sourceMaps',
    'transpilePackages',
    'zip',
    'zipDir',
    'zipFilename',
    'zipSource'
  ]),
  start: keysOf<NonNullable<CommandBlocks['start']> & StartOptions>()([
    'browser',
    'browserFlags',
    'chromiumBinary',
    'copyFromProfile',
    'define',
    'exclude',
    'excludeBrowserFlags',
    'extensions',
    'firefoxBinary',
    'folders',
    'geckoBinary',
    'host',
    'include',
    'install',
    'keepProfileChanges',
    'logColor',
    'logContexts',
    'logFormat',
    'logLevel',
    'logTab',
    'logTimestamps',
    'logUrl',
    'mode',
    'noBrowser',
    'noOpen',
    'perfBudgets',
    'persistProfile',
    'polyfill',
    'port',
    'preferences',
    'profile',
    'publicHost',
    'startingUrl',
    'transpilePackages'
  ]),
  preview: keysOf<NonNullable<CommandBlocks['preview']> & PreviewOptions>()([
    'allowControl',
    'allowEval',
    'browser',
    'browserFlags',
    'chromiumBinary',
    'copyFromProfile',
    'define',
    'dryRun',
    'excludeBrowserFlags',
    'extensions',
    'firefoxBinary',
    'folders',
    'geckoBinary',
    'host',
    'instanceExplicit',
    'instanceId',
    'keepProfileChanges',
    'logColor',
    'logContexts',
    'logFormat',
    'logLevel',
    'logTab',
    'logTimestamps',
    'logUrl',
    'metadataCommand',
    'mode',
    'noBrowser',
    'noOpen',
    'outputPath',
    'persistProfile',
    'port',
    'preferences',
    'profile',
    'publicHost',
    'startingUrl',
    'transpilePackages'
  ])
}

// A browser block is merged into every command, so it reads what any of them
// does. The vendor names stay open: a fork may name its own block.
const BROWSER_BLOCK_KEYS: ReadonlySet<string> = new Set([
  ...keysOf<BrowserConfig>()([
    'appIcon',
    'appName',
    'browser',
    'browserFlags',
    'bundleId',
    'chromiumBinary',
    'copyFromProfile',
    'define',
    'developmentTeam',
    'exclude',
    'excludeBrowserFlags',
    'extensions',
    'firefoxBinary',
    'folders',
    'forceRegenerate',
    'geckoBinary',
    'include',
    'keepProfileChanges',
    'macOsOnly',
    'noOpen',
    'perfBudgets',
    'persistProfile',
    'preferences',
    'profile',
    'safariBinary',
    'startingUrl',
    'transpilePackages'
  ]),
  ...Object.values(COMMAND_KEYS).flat()
])

export interface UnknownConfigKey {
  path: string
  suggestion?: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Edits between two names, a swap of two neighbors counted as one edit.
function editDistance(a: string, b: string): number {
  const rows = Array.from({length: a.length + 1}, (_, i) =>
    Array.from({length: b.length + 1}, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0
    )
  )

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1

      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      )

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1)
      }
    }
  }

  return rows[a.length][b.length]
}

// The accepted key a typo most likely meant, when one is close enough.
function closest(key: string, accepted: Iterable<string>): string | undefined {
  let best: {name: string; distance: number} | undefined

  for (const name of accepted) {
    const distance =
      name.toLowerCase() === key.toLowerCase() ? 0 : editDistance(key, name)

    if (!best || distance < best.distance) best = {name, distance}
  }

  return best && best.distance <= Math.max(1, Math.floor(key.length / 4))
    ? best.name
    : undefined
}

function unknownIn(
  block: Record<string, unknown>,
  scope: string,
  accepted: Iterable<string>
): UnknownConfigKey[] {
  const known = new Set(accepted)

  return Object.keys(block)
    .filter((key) => !known.has(key))
    .map((key) => {
      const suggestion = closest(key, known)

      return {
        path: `${scope}.${key}`,
        ...(suggestion ? {suggestion: `${scope}.${suggestion}`} : {})
      }
    })
}

// The keys under commands.<name> and browser.<vendor> that nothing reads,
// each with its full path. A value that is not an object is left alone.
export function unknownNestedConfigKeys(config: object): UnknownConfigKey[] {
  const {commands, browser} = config as {commands?: unknown; browser?: unknown}
  const found: UnknownConfigKey[] = []

  if (isPlainObject(commands)) {
    found.push(...unknownIn(commands, 'commands', Object.keys(COMMAND_KEYS)))

    for (const [name, accepted] of Object.entries(COMMAND_KEYS)) {
      const block = commands[name]

      if (isPlainObject(block)) {
        found.push(...unknownIn(block, `commands.${name}`, accepted))
      }
    }
  }

  if (isPlainObject(browser)) {
    for (const [vendor, block] of Object.entries(browser)) {
      if (isPlainObject(block)) {
        found.push(...unknownIn(block, `browser.${vendor}`, BROWSER_BLOCK_KEYS))
      }
    }
  }

  return found
}
