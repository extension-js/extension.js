//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as messages from './messages'

export type OutputFormat = 'pretty' | 'json'

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

// --output wins; a deprecated alias still takes effect but warns once on
// stderr. An unrecognized value falls through, matching the old parsers.
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
