//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import type {Command} from 'commander'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {loadExtensionDevelopBridgeModule} from '../helpers/extension-develop-runtime'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE} from '../helpers/messaging'
import {
  resolveSessionProjectPath,
  sessionLogsPath,
  sessionReadyPath
} from '../helpers/session-project-path'

// How `--since` is read, resolved by the develop bridge's query helpers so
// the command and the published query agree: a sequence number, or a point
// in time compared against the event clock.
type LogSince = {seq: number} | {time: number}
type SinceHelpers = {
  parseLogSince: (value: unknown) => LogSince | null | undefined
  isAfterSince: (event: LogEventLike, since: LogSince) => boolean
}

// The same reading as the develop bridge's helpers, kept here so a runtime
// that predates them still honors an ISO value; the bridge's copy wins when
// it is there so the command and the published query never drift apart.
function parseLogSinceLocal(value: unknown): LogSince | null | undefined {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? {seq: value} : undefined
  }
  const text = String(value).trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return {seq: Number(text)}
  const time = Date.parse(text)
  return Number.isFinite(time) ? {time} : undefined
}

function isAfterSinceLocal(event: LogEventLike, since: LogSince): boolean {
  if ('seq' in since) {
    return !(typeof event.seq === 'number' && event.seq <= since.seq)
  }
  const raw = (event as {timestamp?: unknown; ts?: unknown}).timestamp
  const time =
    typeof raw === 'number'
      ? raw
      : typeof (event as {ts?: unknown}).ts === 'string'
        ? Date.parse(String((event as {ts?: unknown}).ts))
        : Number.NaN
  return !Number.isFinite(time) || time > since.time
}

function sinceHelpersFrom(bridge: unknown): SinceHelpers {
  const candidate = bridge as Partial<SinceHelpers> | null | undefined
  return {
    parseLogSince:
      typeof candidate?.parseLogSince === 'function'
        ? candidate.parseLogSince
        : parseLogSinceLocal,
    isAfterSince:
      typeof candidate?.isAfterSince === 'function'
        ? candidate.isAfterSince
        : isAfterSinceLocal
  }
}

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

// One narrowing at the parse boundary: a line that is not a JSON object is
// not an event, so the filters and printers only ever see the loose view
// below and never an untyped parse result.
function parseLogLine(line: string): LogEventLike | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  return isLogEventLike(parsed) ? parsed : null
}

function isLogEventLike(value: unknown): value is LogEventLike {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Bridge log events are dynamic ndjson lines; this loose view names every
// field the filters and printers probe.
export interface LogEventLike {
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

function makeFilter(
  opts: LogsOptions,
  since: LogSince | null,
  helpers: SinceHelpers
) {
  const minLevel = String(opts.level || 'all').toLowerCase()
  const contexts =
    opts.context && opts.context.toLowerCase() !== 'all'
      ? new Set(opts.context.split(',').map((c) => c.trim()))
      : null
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

    if (since && !helpers.isAfterSince(event, since)) return false

    if (urlMatches && !urlMatches(event)) return false

    if (tabId != null && Number.isFinite(tabId) && event.tabId !== tabId) {
      return false
    }

    return true
  }
}

function resolveFormat(opts: LogsOptions): 'pretty' | 'json' | 'ndjson' {
  const requested = String(opts.output ?? '')
    .trim()
    .toLowerCase()
  if (
    requested === 'pretty' ||
    requested === 'json' ||
    requested === 'ndjson'
  ) {
    return requested
  }

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

  // eslint-disable-next-line no-console
  console.log(formatPrettyLogLine(event))
}

// Shared with `inspect --with-console` so console lines read the same in
// both commands.
export function formatPrettyLogLine(event: LogEventLike): string {
  const parts = Array.isArray(event.messageParts)
    ? event.messageParts
        .map((p: unknown) => (typeof p === 'string' ? p : JSON.stringify(p)))
        .join(' ')
    : ''
  const code = event.code ? ` ${event.code}` : ''
  const remediation = event.remediation ? `\n    ↳ ${event.remediation}` : ''
  return (
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
    .option(
      '--signals-only',
      '[experimental] show only structured dx.signal diagnostics. No emitter ships yet, so this currently prints nothing'
    )
    .option(
      '--since <seq|iso>',
      'only show events after this sequence number or ISO timestamp'
    )
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
      const bridge = await loadExtensionDevelopBridgeModule()
      const projectPath = resolveSessionProjectPath(bridge, projectPathArg)
      const browser = options.browser || 'chromium'
      const format = resolveFormat(options)
      const helpers = sinceHelpersFrom(bridge)
      const since = helpers.parseLogSince(options.since)
      if (
        options.since != null &&
        options.since !== '' &&
        since === undefined
      ) {
        const message = `extension logs --since expects a sequence number or an ISO timestamp, got: ${options.since}`
        // eslint-disable-next-line no-console
        console.error(message)
        if (format !== 'pretty') {
          writeFrame(
            ENVELOPE.fail('logs', 'usage', {
              code: CODES.E_INVALID_OPTION,
              message,
              name: 'CliError'
            })
          )
        }
        process.exit(1)
      }
      const matches = makeFilter(options, since ?? null, helpers)

      // An advertised filter that silently matches nothing teaches the wrong
      // lesson (ledger 181, same class as 179): the user reads the silence as
      // "my extension has no signals" when the truth is that nothing produces
      // them. The warning goes to stderr so json/ndjson stdout stays clean,
      // and it covers both the one-shot and --follow paths.
      if (options.signalsOnly) {
        // eslint-disable-next-line no-console
        console.error(
          'extension logs --signals-only: no signals emitter ships in this ' +
            'build, so dev sessions record no dx.signal events and this ' +
            'filter will print nothing.'
        )
      }

      if (options.follow) {
        await followLogs(projectPath, browser, format, matches)
        return
      }

      // One-shot: read the logs.ndjson file directly (no control channel needed).
      const file = sessionLogsPath(bridge, projectPath, browser)
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
        const event = parseLogLine(line)
        if (event && matches(event)) printEvent(event, format)
      }
    })
}

async function followLogs(
  projectPath: string,
  browser: string,
  format: 'pretty' | 'json' | 'ndjson',
  matches: (e: LogEventLike) => boolean
) {
  const bridge = await loadExtensionDevelopBridgeModule()
  const {BridgeConsumer, readReadyContract} = bridge

  const ready = readReadyContract(projectPath, browser)
  if (!ready) {
    const message =
      `No active dev session control channel found for ${browser}. ` +
      `Looked at ${sessionReadyPath(bridge, projectPath, browser)}. ` +
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

  // A follow outlives its channel in two ways that no reconnect can mend: the
  // dev session ends (the engine stamps ready.json 'stopped', or a new session
  // rewrites it), or the server refuses the hello outright. Left to the
  // consumer's retry loop, the command would sit silent forever and a machine
  // reader could not tell that from a quiet extension. A close the contract no
  // longer backs ends the follow with one terminating frame instead.
  let settle: () => void = () => {}
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  const refusals = new Set<number>(
    [
      bridge.CLOSE_BAD_INSTANCE,
      bridge.CLOSE_BAD_HELLO,
      bridge.CLOSE_CONTROL_UNAVAILABLE
    ].filter((code): code is number => typeof code === 'number')
  )
  const sessionStillNamed = (): boolean => {
    const current = readReadyContract(projectPath, browser)
    return (
      Boolean(current) &&
      current.status !== 'stopped' &&
      current.instanceId === ready.instanceId &&
      current.controlPort === ready.controlPort
    )
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
    },
    onClose: (close: {code: number; reason: string}) => {
      if (!refusals.has(close.code) && sessionStillNamed()) return
      consumer.close()
      const why = close.reason ? `${close.code}, ${close.reason}` : close.code
      // eslint-disable-next-line no-console
      console.error(
        `extension logs --follow: the control channel closed (${why}) and the dev session is over.`
      )
      if (format !== 'pretty') {
        // console.log for the same reason as the interrupt frame below: it
        // must land after every record already queued on stdout.
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            ENVELOPE.ok('logs', 'closed', {
              closeCode: close.code,
              reason: close.reason,
              follow: true
            })
          )
        )
      }
      settle()
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
  // The socket keeps the process alive while following. Returning once the
  // channel is gone for good lets the process end on its own, so the
  // beforeExit telemetry flush still runs and the exit code stays 0.
  await settled
}
