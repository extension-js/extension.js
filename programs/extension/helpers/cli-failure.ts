//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import colors from 'pintor'
import {scanArgvValue} from './cli-argv'
import {profileLockedHint} from './messages'
import {
  CODES,
  ENVELOPE,
  type EnvelopeError,
  type EnvelopeErrorRefs,
  type ErrorCode,
  prefix,
  stripChannelPrefix
} from './messaging'
import {normalizeOutputFormat} from './output-flag'

// One machine-readable stdout frame per process: commands that already framed
// their failure mark the rethrown error so the top-level handler stays silent.
const FRAMED_FLAG = 'extensionEnvelopePrinted'

export function markErrorFramed(err: unknown): void {
  if (err && typeof err === 'object') {
    try {
      ;(err as Record<string, unknown>)[FRAMED_FLAG] = true
    } catch {
      // Ignore
    }
  }
}

export function isErrorFramed(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      (err as Record<string, unknown>)[FRAMED_FLAG] === true
  )
}

export function wantsJsonOutput(argv: string[]): boolean {
  return normalizeOutputFormat(scanArgvValue(argv, '--output')) === 'json'
}

interface CommanderErrorLike {
  code?: unknown
  exitCode?: unknown
  message?: unknown
}

export function isCommanderError(err: unknown): err is CommanderErrorLike {
  return Boolean(
    err &&
      typeof err === 'object' &&
      typeof (err as CommanderErrorLike).code === 'string' &&
      String((err as CommanderErrorLike).code).startsWith('commander.')
  )
}

export function commanderExitCode(err: CommanderErrorLike): number {
  const exitCode = Number((err as {exitCode?: unknown}).exitCode)

  return Number.isFinite(exitCode) ? exitCode : 1
}

function firstQuoted(message: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(message)

  return match?.[1]
}

const EXCESS_PATTERN = /Expected (\d+) arguments? but got (\d+): (.*)\.$/

// The values past the last one a command takes. Nothing when commander's list
// cannot be split back into exactly the values it received.
function excessArguments(
  message: string
): {expected: number; extra: string[]} | undefined {
  const match = EXCESS_PATTERN.exec(message.split('\n')[0])
  if (!match) return undefined

  const expected = Number(match[1])
  const values = match[3].split(', ')

  if (values.length !== Number(match[2]) || values.length <= expected) {
    return undefined
  }

  return {expected, extra: values.slice(expected)}
}

// An unquoted path with spaces is the usual way to get here, so that comes first.
function excessRemedy(helpCommand: string): string {
  return `Put quotes around a path that has spaces, or run ${helpCommand} to see the arguments.`
}

function helpCommandFor(command: string): string {
  return command && command !== 'extension'
    ? `extension ${command}`
    : 'extension'
}

function refsFromMessage(
  code: string,
  message: string
): EnvelopeErrorRefs | undefined {
  if (code === 'commander.unknownOption') {
    const flag = firstQuoted(message, /'(-[^']*)'/)

    return flag ? {flag} : undefined
  }

  if (code === 'commander.unknownCommand') {
    const command = firstQuoted(message, /'([^']+)'/)

    return command ? {command} : undefined
  }

  if (
    code === 'commander.invalidArgument' ||
    code === 'commander.optionMissingArgument'
  ) {
    const option = firstQuoted(message, /option '([^']+)'/)
    const flag = option?.split(/\s+/)[0]

    return flag?.startsWith('-') ? {flag} : undefined
  }

  return undefined
}

export function codeForCommanderError(code: string): ErrorCode {
  if (code === 'commander.unknownCommand') return CODES.E_UNKNOWN_COMMAND
  if (code === 'commander.unknownOption') return CODES.E_FLAG_NOT_SUPPORTED_HERE

  if (
    code === 'commander.invalidArgument' ||
    code === 'commander.optionMissingArgument'
  ) {
    return CODES.E_FLAG_VALUE_INVALID
  }

  return CODES.E_ARGS
}

export function commanderErrorEnvelope(
  err: CommanderErrorLike,
  command: string
): ReturnType<typeof ENVELOPE.fail> {
  const commanderCode = String(err.code)
  const message = String(err.message || 'the command line could not be parsed')
    .replace(/^error:\s*/i, '')
    .trim()
  const error: EnvelopeError = {
    code: codeForCommanderError(commanderCode),
    message,
    name: 'CliError'
  }
  const refs = refsFromMessage(commanderCode, message)
  if (refs) error.refs = refs

  const hint =
    commanderCode === 'commander.excessArguments' && excessArguments(message)
      ? excessRemedy(`${helpCommandFor(command)} --help`)
      : undefined

  return ENVELOPE.fail(command, 'usage', error, hint ? {hint} : {})
}

const SUGGESTION_PATTERN = /\(Did you mean (one of )?(.+)\?\)/

// The verbs other scaffolders use. Spelling suggestions never reach `create`
// from them, so the remedy names it.
const PROJECT_START_VERBS = new Set(['init', 'new'])

function sentenceCase(input: string): string {
  const trimmed = input.trim()
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)

  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`
}

// The styled twin of commanderErrorEnvelope: same classification, rendered as
// the standard error anatomy (label line, then one typeable remedy).
export function commanderHumanError(
  err: CommanderErrorLike,
  command: string
): string {
  const commanderCode = String(err.code)
  const message = String(err.message || 'the command line could not be parsed')
    .replace(/^error:\s*/i, '')
    .trim()
  const refs = refsFromMessage(commanderCode, message)

  let label: string | undefined
  let noun: 'options' | 'commands' = 'options'
  const excess =
    commanderCode === 'commander.excessArguments'
      ? excessArguments(message)
      : undefined

  if (commanderCode === 'commander.unknownOption' && refs?.flag) {
    label = `Unknown option ${refs.flag}.`
  } else if (commanderCode === 'commander.unknownCommand' && refs?.command) {
    label = `Unknown command ${refs.command}.`
    noun = 'commands'
  } else if (
    commanderCode === 'commander.optionMissingArgument' &&
    refs?.flag
  ) {
    label = `Missing value for ${refs.flag}.`
  } else if (excess) {
    const takes =
      excess.expected === 0
        ? 'no arguments'
        : `${excess.expected} argument${excess.expected === 1 ? '' : 's'}`

    label =
      `Unexpected argument${excess.extra.length === 1 ? '' : 's'}: ` +
      `${excess.extra.join(', ')}. ${helpCommandFor(command)} takes ${takes}.`
  }

  if (!label) label = sentenceCase(message.split('\n')[0])

  const helpTarget = noun === 'options' ? helpCommandFor(command) : 'extension'
  const suggestion = SUGGESTION_PATTERN.exec(message)
  const startsAProject =
    commanderCode === 'commander.unknownCommand' &&
    PROJECT_START_VERBS.has(String(refs?.command))
  const remedy = startsAProject
    ? `Run ${colors.blue('extension create my-extension')} to start a new extension.`
    : excess
      ? excessRemedy(colors.blue(`${helpTarget} --help`))
      : suggestion
        ? `Did you mean ${suggestion[1] || ''}${colors.blue(suggestion[2])}?`
        : `Run ${colors.blue(`${helpTarget} --help`)} to see the ${noun}.`

  return `${prefix('error', label)} ${label}\n${remedy}`
}

// A refusal raised deeper in the engine names its own failure class, so the
// frame reports that instead of folding every throw into one generic code.
export function isUsageCode(code: ErrorCode): boolean {
  return (
    code === CODES.E_BROWSER_BINARY_INVALID ||
    code === CODES.E_BROWSER_BINARY_REQUIRED ||
    code === CODES.E_FLAG_NOT_SUPPORTED_HERE
  )
}

export function declaredErrorCode(err: unknown): ErrorCode | undefined {
  const code = (err as {code?: unknown} | null | undefined)?.code
  if (typeof code !== 'string') return undefined

  return Object.prototype.hasOwnProperty.call(CODES, code)
    ? (code as ErrorCode)
    : undefined
}

// One status and one code for a load the browser refused, on every command,
// so a reader branches on it without knowing which command met the refusal.
export const LOAD_REFUSED_STATUS = 'load-refused'
export const LOAD_REFUSED_HINT =
  'Fix what the browser names, then run the command again.'

export function isLoadRefused(err: unknown): boolean {
  return declaredErrorCode(err) === CODES.E_EXTENSION_LOAD_REFUSED
}

// A producer that knows a closer remedy than the general one names it.
export function loadRefusedEnvelope(
  err: unknown,
  command: string
): ReturnType<typeof ENVELOPE.fail> {
  const hint = (err as {hint?: unknown} | null | undefined)?.hint

  return ENVELOPE.fail(
    command,
    LOAD_REFUSED_STATUS,
    {
      code: CODES.E_EXTENSION_LOAD_REFUSED,
      message: stripChannelPrefix(
        err instanceof Error ? err.message : String(err)
      )
    },
    {hint: typeof hint === 'string' && hint ? hint : LOAD_REFUSED_HINT}
  )
}

// The way out of these failures is the same on every command, so dev, start
// and preview read it from here and their frames cannot drift apart.
export function failureHint(code: ErrorCode | undefined): string | undefined {
  return code === CODES.E_PROFILE_LOCKED ? profileLockedHint() : undefined
}

export function internalErrorEnvelope(
  err: unknown,
  command: string
): ReturnType<typeof ENVELOPE.fail> {
  if (isLoadRefused(err)) return loadRefusedEnvelope(err, command)

  const code = declaredErrorCode(err) ?? CODES.E_INTERNAL
  const hint = failureHint(code)

  // A bad pinned binary is a value the user typed, on every command.
  return ENVELOPE.fail(
    command,
    isUsageCode(code) ? 'usage' : 'failed',
    {
      code,
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : 'Error'
    },
    hint ? {hint} : {}
  )
}

export function earlyExitEnvelope(
  command: string,
  code: ErrorCode,
  message: string,
  refs?: EnvelopeErrorRefs
): ReturnType<typeof ENVELOPE.fail> {
  const error: EnvelopeError = {code, message, name: 'CliError'}
  if (refs) error.refs = refs

  return ENVELOPE.fail(command, 'usage', error)
}

// process.exit can cut a queued console.log on a pipe, and this frame is the
// last thing a machine consumer sees, so write it synchronously.
export function writeStdoutFrame(frame: unknown): void {
  try {
    fs.writeSync(1, `${JSON.stringify(frame)}\n`)
  } catch {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(frame))
  }
}
