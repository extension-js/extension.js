//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Command} from 'commander'
import {exitWithFailure} from './exit-after-drain'
import * as messages from './messages'
import {CODES} from './messaging'
import type {reportCommandFailureNow} from './telemetry-cli'

export type OutputFormat = 'pretty' | 'json'

const OUTPUT_CHOICES: readonly string[] = ['pretty', 'json']

// One notice per process, not per flag: a single invocation can carry more
// than one deprecated alias, and two notices read like two separate problems.
let warnedDeprecatedAlias = false

export function warnDeprecatedOutputAlias(flag: string): void {
  if (warnedDeprecatedAlias) return

  warnedDeprecatedAlias = true
  // stderr on purpose: under --output json stdout carries exactly one
  // machine-readable document and a notice there would corrupt the parse.
  // eslint-disable-next-line no-console
  console.error(messages.deprecatedOutputAlias(flag))
}

// The one reading of an output value: case and surrounding spaces never
// change what a caller asked for.
export function normalizeOutputFormat(
  value: unknown
): OutputFormat | undefined {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()

  return v === 'pretty' || v === 'json' ? v : undefined
}

const normalize = normalizeOutputFormat

export function isJsonOutput(opts: {
  output?: string
  format?: string
  waitFormat?: string
}): boolean {
  return resolveOutputFormat(opts) === 'json'
}

// The entry rewrites --format to --output before parsing, so a refusal of
// that value has to be told which of the two the user typed.
let outputSpelledAs: '--output' | '--format' = '--output'

export function outputFlagTypedAs(flag: '--output' | '--format'): void {
  outputSpelledAs = flag
}

// The refusal for the first output flag typed with a value that is neither
// pretty nor json. A typo read as pretty printed prose where JSON was expected.
export function invalidOutputFlagMessage(
  opts: {
    output?: string
    format?: string
    waitFormat?: string
  },
  choices: readonly string[] = OUTPUT_CHOICES
): string | undefined {
  const typed = [
    [outputSpelledAs, opts.output],
    ['--format', opts.format],
    ['--wait-format', opts.waitFormat]
  ] as const

  for (const [flag, value] of typed) {
    if (value === undefined) continue
    if (choices.includes(String(value).trim().toLowerCase())) continue

    return messages.invalidOutputValue(flag, String(value), choices)
  }

  return undefined
}

// The preAction hook of every command that registers --output, so a value it
// cannot read is refused with one text before the action does any work.
export function refuseUnreadableOutput({
  choices = OUTPUT_CHOICES,
  reportFailure
}: {
  choices?: readonly string[]
  reportFailure?: typeof reportCommandFailureNow
} = {}): (command: Command, actionCommand: Command) => void {
  return (_command, actionCommand) => {
    const invalid = invalidOutputFlagMessage(actionCommand.opts(), choices)
    if (!invalid) return

    // eslint-disable-next-line no-console
    console.error(messages.usageRefusal(invalid))
    exitWithFailure(CODES.E_INVALID_OPTION, 1, reportFailure)
  }
}

// --output wins; a deprecated alias still takes effect but warns once on
// stderr. A command refuses an unrecognized value before it reads this.
export function resolveOutputFormat(opts: {
  output?: string
  format?: string
  waitFormat?: string
}): OutputFormat {
  const direct = normalize(opts.output)
  if (direct) return direct

  const aliases = [
    ['--format', opts.format],
    ['--wait-format', opts.waitFormat]
  ] as const

  for (const [flag, value] of aliases) {
    const resolved = normalize(value)
    if (!resolved) continue

    warnDeprecatedOutputAlias(flag)

    return resolved
  }

  return 'pretty'
}
