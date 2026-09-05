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
import {
  CODES,
  ENVELOPE,
  type EnvelopeError,
  type EnvelopeErrorRefs,
  type ErrorCode,
  prefix
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

function codeForCommanderError(code: string): ErrorCode {
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

  return ENVELOPE.fail(command, 'usage', error)
}

const SUGGESTION_PATTERN = /\(Did you mean (one of )?(.+)\?\)/

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
  }
  if (!label) label = sentenceCase(message.split('\n')[0])

  const helpTarget =
    noun === 'options' && command && command !== 'extension'
      ? `extension ${command}`
      : 'extension'
  const suggestion = SUGGESTION_PATTERN.exec(message)
  const remedy = suggestion
    ? `Did you mean ${suggestion[1] || ''}${colors.blue(suggestion[2])}?`
    : `Run ${colors.blue(`${helpTarget} --help`)} to see the ${noun}.`

  return `${prefix('error')} ${label}\n${remedy}`
}

export function internalErrorEnvelope(
  err: unknown,
  command: string
): ReturnType<typeof ENVELOPE.fail> {
  return ENVELOPE.fail(command, 'failed', {
    code: CODES.E_INTERNAL,
    message: err instanceof Error ? err.message : String(err),
    name: err instanceof Error ? err.name : 'Error'
  })
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
