//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import type {Command} from 'commander'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {loadExtensionDevelopBridgeModule} from '../helpers/extension-develop-runtime'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE} from '../helpers/messaging'

type LogsOptions = {
  browser?: string
  follow?: boolean
  context?: string
  level?: string
  signalsOnly?: boolean
  since?: string
  url?: string
  tab?: string
  output?: 'pretty' | 'json' | 'ndjson'
}

// Bridge log events are dynamic ndjson lines; this loose view names every
// field the filters and printers probe.
interface LogEventLike {
  type?: unknown
  eventType?: unknown
  context?: unknown
  level?: unknown
  seq?: unknown
  url?: unknown
  hostname?: unknown
  tabId?: unknown
  messageParts?: unknown
  code?: unknown
  remediation?: unknown
}

// Increasing verbosity; selecting a level includes it + everything more severe.
const LEVEL_ORDER = ['error', 'warn', 'info', 'debug', 'trace']

function levelRank(level: string): number {
  const l = level === 'log' ? 'info' : level
  const i = LEVEL_ORDER.indexOf(l)
  return i === -1 ? LEVEL_ORDER.length : i
}

// `--url` accepts a glob (`*` = any run of chars) or a plain substring, matched
// against url then hostname. Shared with the MCP extension_logs tool.
function makeUrlMatcher(pattern: string): (event: LogEventLike) => boolean {
  const hasGlob = pattern.includes('*')
  let re: RegExp | null = null

  if (hasGlob) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
    re = new RegExp(escaped)
  }

  return (event: LogEventLike): boolean => {
    const candidates = [event.url, event.hostname].filter(
      (v) => typeof v === 'string'
    ) as string[]

    if (candidates.length === 0) return false

    return candidates.some((c) => (re ? re.test(c) : c.includes(pattern)))
  }
}

function makeFilter(opts: LogsOptions) {
  const minLevel = String(opts.level || 'all').toLowerCase()
  const contexts =
    opts.context && opts.context.toLowerCase() !== 'all'
      ? new Set(opts.context.split(',').map((c) => c.trim()))
      : null
  const sinceSeq = opts.since != null ? Number(opts.since) : null
  const urlMatches = opts.url ? makeUrlMatcher(opts.url) : null
  const tabId = opts.tab != null && opts.tab !== '' ? Number(opts.tab) : null

  return (event: LogEventLike): boolean => {
    if (!event || typeof event !== 'object') return false
    if (event.type === 'header') return false

    if (opts.signalsOnly && event.eventType !== 'dx.signal') return false

    if (contexts && !contexts.has(String(event.context))) return false

    if (minLevel !== 'all' && minLevel !== 'off') {
      if (levelRank(String(event.level || '')) > levelRank(minLevel))
        return false
    }

    if (
      sinceSeq != null &&
      Number.isFinite(sinceSeq) &&
      typeof event.seq === 'number' &&
      event.seq <= sinceSeq
    ) {
      return false
    }

    if (urlMatches && !urlMatches(event)) return false

    if (tabId != null && Number.isFinite(tabId) && event.tabId !== tabId) {
      return false
    }

    return true
  }
}

function resolveFormat(opts: LogsOptions): 'pretty' | 'json' | 'ndjson' {
  if (opts.output) return opts.output

  return process.stdout.isTTY ? 'pretty' : 'ndjson'
}

function printEvent(event: LogEventLike, format: 'pretty' | 'json' | 'ndjson') {
  if (format === 'ndjson') {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(event))
    return
  }

  if (format === 'json') {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(event, null, 2))
    return
  }

  const parts = Array.isArray(event.messageParts)
    ? event.messageParts
        .map((p: unknown) => (typeof p === 'string' ? p : JSON.stringify(p)))
        .join(' ')
    : ''
  const code = event.code ? ` ${event.code}` : ''
  const remediation = event.remediation ? `\n    ↳ ${event.remediation}` : ''
  // eslint-disable-next-line no-console
  console.log(
    `[${event.seq ?? '-'}] ${String(event.level || 'log').toUpperCase()} ` +
      `(${event.context})${code} ${parts}${remediation}`
  )
}

// D7 keeps log records in their own encoding; only a terminating frame is an
// envelope. process.exit can cut a queued console.log on a pipe (#79), so the
// frame is written synchronously, which is safe here because both failure
// paths bail out before a single record has been printed.
function writeFrame(frame: unknown): void {
  try {
    fs.writeSync(1, `${JSON.stringify(frame)}\n`)
  } catch {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(frame))
  }
}

function logsFilePath(projectPath: string, browser: string): string {
  return path.resolve(
    projectPath,
    'dist',
    'extension-js',
    browser,
    'logs.ndjson'
  )
}

export function registerLogsCommand(program: Command) {
  program
    .command('logs')
    .arguments('[project-path]')
    .usage('[project-path] [options]')
    .description(commandDescriptions.logs)
    .option(
      '--browser <chrome | chromium | edge | firefox>',
      'which dist/extension-js/<browser> to read. Defaults to `chromium`'
    )
    .option(
      '--follow',
      'stream live via the control channel instead of printing and exiting'
    )
    .option(
      '--context <list>',
      'comma-separated contexts (background, content, popup, options, sidebar, devtools, page)'
    )
    .option(
      '--level <off|error|warn|info|debug|trace|all>',
      'minimum severity to show. Defaults to `all`'
    )
    .option('--signals-only', 'show only structured dx.signal diagnostics')
    .option('--since <seq|iso>', 'only show events after this sequence number')
    .option(
      '--url <glob|substring>',
      'only events whose url/hostname matches (glob with * or plain substring)'
    )
    .option('--tab <id>', 'only events from this tab id')
    .option(
      '--output <pretty|json|ndjson>',
      'output format. Defaults to pretty on a TTY, ndjson when piped'
    )
    .action(async (projectPathArg: string, options: LogsOptions) => {
      const projectPath = path.resolve(projectPathArg || process.cwd())
      const browser = options.browser || 'chromium'
      const format = resolveFormat(options)
      const matches = makeFilter(options)

      if (options.follow) {
        await followLogs(projectPath, browser, format, matches)
        return
      }

      // One-shot: read the logs.ndjson file directly (no control channel needed).
      const file = logsFilePath(projectPath, browser)
      if (!fs.existsSync(file)) {
        const message =
          `No logs found at ${file}. Start a dev session (extension dev) first, ` +
          `or pass --browser to match it.`
        // eslint-disable-next-line no-console
        console.error(message)

        if (format !== 'pretty') {
          writeFrame(
            ENVELOPE.fail('logs', 'not-found', {
              code: CODES.E_LOGS_NOT_FOUND,
              message,
              name: 'CliError'
            })
          )
        }

        process.exit(1)
      }
      const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
      for (const line of lines) {
        let event: LogEventLike
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        if (matches(event)) printEvent(event, format)
      }
    })
}

async function followLogs(
  projectPath: string,
  browser: string,
  format: 'pretty' | 'json' | 'ndjson',
  matches: (e: LogEventLike) => boolean
) {
  const {BridgeConsumer, readReadyContract} =
    await loadExtensionDevelopBridgeModule()

  const ready = readReadyContract(projectPath, browser)
  if (!ready) {
    const message =
      `No active dev session control channel found for ${browser}. ` +
      `Run \`extension dev --browser=${browser}\` first.`
    // eslint-disable-next-line no-console
    console.error(message)

    if (format !== 'pretty') {
      writeFrame(
        ENVELOPE.fail('logs', 'not-found', {
          code: CODES.E_SESSION_NOT_FOUND,
          message,
          name: 'CliError'
        })
      )
    }

    process.exit(1)
  }

  const consumer = new BridgeConsumer({
    controlPort: ready.controlPort,
    instanceId: ready.instanceId,
    reconnect: true,
    onLog: (event: LogEventLike) => {
      if (matches(event)) printEvent(event, format)
    },
    onGap: (gap: {dropped?: unknown; reason?: unknown}) => {
      // eslint-disable-next-line no-console
      console.error(
        `… ${gap.dropped} event(s) dropped (${gap.reason}), stream is behind`
      )
    }
  })

  // A follow stream that just stops leaves a machine consumer unable to tell a
  // clean interrupt from a crash. Emit one terminating frame either way.
  const shutdown = (signal: NodeJS.Signals) => {
    consumer.close()

    if (format !== 'pretty') {
      // console.log, not writeFrame: records already streamed through stdout,
      // and a synchronous write would jump the queue and land before them.
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          ENVELOPE.ok('logs', 'interrupted', {signal, follow: true})
        )
      )
    }

    void exitAfterDrain(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  consumer.start()
  // Keep the process alive while following.
  await new Promise<void>(() => {})
}
