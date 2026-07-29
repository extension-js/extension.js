// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
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
  const watching =
    mode === 'development' ? ' Watching for file changes.' : ''
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

export function browserRunnerDisabled(args: {
  browser: string
  manifestPath: string
  readyPath: string
  browserModeLabel?: string
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

  return card({
    version: extensionJsVersion,
    rows: [
      {
        label: 'Browser',
        value: browserRowValue(
          String(args.browser || 'unknown'),
          args.browserModeLabel || `${browserLabel} (build-only mode)`
        )
      },
      {label: 'Extension', value: extensionLabel},
      {label: 'Run ID', value: runLabel}
    ]
  })
}

export function portInUse(requestedPort: number, newPort: number) {
  return (
    `The requested port ${colors.brightBlue(requestedPort.toString())} is in use.\n` +
    `The dev server uses ${colors.brightBlue(newPort.toString())} instead.`
  )
}

export function extensionJsRunnerError(error: unknown) {
  return `Extension.js could not start the runner.\n${colors.red(String(error))}`
}

export function autoExitModeEnabled(ms: number) {
  return (
    `Auto-exit is enabled.\n` +
    `The process exits after ${colors.brightBlue(ms.toString())} ms if idle.`
  )
}

export function autoExitTriggered(ms: number) {
  return (
    `Auto-exit triggered after ${colors.brightBlue(ms.toString())} ms.\n` +
    `Clean up and exit.`
  )
}

export function autoExitForceKill(ms: number) {
  return `Force-kill the process after ${colors.brightBlue(ms.toString())} ms to ensure exit.`
}

export function devServerStartTimeout(ms: number) {
  return [
    `Dev server startup is taking longer than expected (${colors.brightBlue(ms.toString())} ms).`,
    `The bundler may have encountered an error before emitting the first build.`,
    `If nothing else prints, try setting ${colors.brightBlue('EXTENSION_VERBOSE=1')} for more logs.`
  ].join('\n')
}

export function bundlerFatalError(error: unknown) {
  const text =
    error instanceof Error ? error.stack || error.message : String(error)
  return `Build failed to start:\n${colors.red(text)}`
}

export function bundlerRecompiling() {
  return `Recompile due to file changes…`
}

export function noEntrypointsDetected(port: number) {
  return [
    `No entrypoints or assets were produced by the initial compilation.`,
    `The dev server is running on 127.0.0.1:${colors.brightBlue(port.toString())}, but nothing is being built.`,
    `Possible causes:`,
    `  • Empty or missing entry configuration.`,
    `  • Extension-related plugins are disabled (entries not derived from manifest).`,
    `  • All sources are ignored or excluded.`,
    `Try enabling verbose logs with ${colors.brightBlue('EXTENSION_VERBOSE=1')} or review your extension config.`
  ].join('\n')
}

export function spacerLine() {
  // Turbo-prefixed logs can collapse truly empty lines; keep one space.
  return ' '
}
