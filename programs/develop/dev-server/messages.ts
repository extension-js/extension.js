// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import colors from 'pintor'
import {
  artifactNoun,
  browserRowValue,
  type Channel,
  card,
  prefix
} from '../lib/messaging'

const cjsRequire = createRequire(import.meta.url)

function getLoggingPrefix(type: Channel): string {
  return prefix(type)
}

export function ready(mode: 'development' | 'production', browser: string) {
  const noun = artifactNoun(browser)
  const state = colors.green(`ready for ${mode}`)
  const watching = mode === 'development' ? ' Watching for file changes.' : ''
  return `${getLoggingPrefix('success')} ${noun} ${state}.${watching}`
}

function readJsonRecord(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}

function capitalizeToken(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join('-')
}

function getExtensionVersion(): string {
  return (
    process.env.EXTENSION_DEVELOP_VERSION ||
    process.env.EXTENSION_CLI_VERSION ||
    (() => {
      try {
        return cjsRequire('../package.json').version
      } catch {
        return 'unknown'
      }
    })()
  )
}

// Card values collapse the home dir for scanability. Evidence and debug lines
// never do, so a pasted path stays valid.
function collapseHomeDirInCardValue(value: string): string {
  const raw = String(value || '')
  const home = os.homedir()
  if (!home || !raw.startsWith(home)) return raw
  const rest = raw.slice(home.length)
  if (rest === '') return '~'
  if (rest.startsWith(path.sep) || rest.startsWith('/')) return `~${rest}`
  return raw
}

export function browserRunnerDisabled(args: {
  browser: string
  manifestPath: string
  readyPath: string
  distPath?: string
}) {
  const manifest = readJsonRecord(args.manifestPath)
  const ready = readJsonRecord(args.readyPath)
  const browserLabel = capitalizeToken(String(args.browser || 'unknown'))
  const runId = String(ready?.runId || '').trim()
  const pid = Number.isInteger(ready?.pid) ? String(ready?.pid) : ''
  // No 'n/a' row: card() drops a row whose value is empty.
  const runLabel = runId
    ? `${runId}${pid ? ` · PID ${pid}` : ''}`
    : pid
      ? `PID ${pid}`
      : ''
  const extensionName = String(manifest?.name || 'Extension')
  const extensionVersion = String(manifest?.version || '').trim()
  const extensionLabel = extensionVersion
    ? `${extensionName} ${extensionVersion}`
    : extensionName
  const extensionJsVersion = getExtensionVersion()

  // Consume the update-suffix env var only once committed to printing, the
  // same way the build card does, so the hint lands on exactly one card.
  const updateSuffix = process.env.EXTENSION_CLI_UPDATE_SUFFIX || ''
  if (updateSuffix) delete process.env.EXTENSION_CLI_UPDATE_SUFFIX

  return card({
    version: extensionJsVersion,
    suffix: updateSuffix,
    rows: [
      {
        label: 'Browser',
        value: browserRowValue(
          String(args.browser || 'unknown'),
          `${browserLabel} (no-browser mode)`
        )
      },
      {label: 'Extension', value: extensionLabel},
      // Run ID before Output: the run id is this card's contract (two preview
      // specs assert it) and is the join key into ready.json, while the served
      // directory is already named by the previewing line above the card.
      {label: 'Run ID', value: runLabel},
      {
        label: 'Output',
        value: collapseHomeDirInCardValue(String(args.distPath || '').trim())
      }
    ]
  })
}

// Port 0 asks the OS for any free port, so a differing answer is the
// requested behavior, not a conflict worth a warning.
export function shouldWarnPortConflict(
  requested: unknown,
  actual: number
): boolean {
  const requestedPort = Number(requested)
  return (
    Number.isFinite(requestedPort) &&
    requestedPort !== 0 &&
    requestedPort !== actual
  )
}

export function portInUse(requestedPort: number, newPort: number) {
  return (
    `${getLoggingPrefix('warn')} Port ${requestedPort} is in use.\n` +
    `The dev server listens on port ${newPort} instead.`
  )
}

export function extensionJsRunnerError(error: unknown) {
  return (
    `${getLoggingPrefix('error')} Extension.js couldn't start the runner.\n` +
    `${colors.red(String(error))}`
  )
}

export function autoExitModeEnabled(ms: number) {
  return (
    `${getLoggingPrefix('info')} Auto-exit is enabled.\n` +
    `The process exits after ${ms} ms of idle time.`
  )
}

export function autoExitTriggered(ms: number) {
  return (
    `${getLoggingPrefix('info')} Auto-exit triggered after ${ms} ms.\n` +
    `The process cleans up and exits now.`
  )
}

export function autoExitForceKill(ms: number) {
  return (
    `${getLoggingPrefix('warn')} The process didn't exit within ${ms} ms, ` +
    `so it exits forcibly now.`
  )
}

export function devServerStartTimeout(ms: number) {
  return [
    `${getLoggingPrefix('warn')} The dev server didn't start within ${ms} ms.`,
    `The bundler may have hit an error before emitting the first build.`,
    `If nothing else prints, set ${colors.blue('EXTENSION_VERBOSE=1')} to see more logs.`
  ].join('\n')
}

export function bundlerFatalError(error: unknown) {
  const text =
    error instanceof Error ? error.stack || error.message : String(error)
  return `${getLoggingPrefix('error')} The build failed to start.\n${colors.red(text)}`
}

export function bundlerRecompiling() {
  return `${getLoggingPrefix('info')} Recompiling due to file changes…`
}

export function noEntrypointsDetected(port: number) {
  return [
    `${getLoggingPrefix('warn')} The first compilation produced no entrypoints or assets.`,
    `The dev server is running on 127.0.0.1:${port}, but nothing is being built.`,
    `Possible causes:`,
    `- Empty or missing entry configuration.`,
    `- Extension plugins are disabled, so entries aren't derived from the manifest.`,
    `- All sources are ignored or excluded.`,
    `Set ${colors.blue('EXTENSION_VERBOSE=1')} to see verbose logs, or review your extension config.`
  ].join('\n')
}

export function spacerLine() {
  // Turbo-prefixed logs can collapse truly empty lines; keep one space.
  return ' '
}
