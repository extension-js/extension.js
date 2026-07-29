// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {scrubBrand} from './branding'
import {prefix} from './messaging'

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

export interface StatsToStringLike {
  toString: (options?: {
    colors?: boolean
    all?: boolean
    errors?: boolean
    warnings?: boolean
  }) => string
}

// The bundler's ERROR/WARNING head lines become standard-anatomy headers; the
// diagnostic body under them keeps its code frames and squiggles verbatim.
export function wrapStatsBlocks(raw: string): string {
  const lines = String(raw || '').split('\n')
  const wrapped: string[] = []
  let inBlock = false

  for (const line of lines) {
    const plain = line.replace(ANSI_PATTERN, '')
    const errorHead = /^ERROR(?: in (.+))?$/.exec(plain)
    const warningHead = /^WARNING(?: in (.+))?$/.exec(plain)

    if (errorHead || warningHead) {
      const file = String((errorHead || warningHead)?.[1] || '')
        .trim()
        .replace(/\.$/, '')
      const kind = errorHead ? 'error' : 'warning'
      const channel = errorHead ? ('error' as const) : ('warn' as const)
      const location = file ? ` in ${file}` : ''
      wrapped.push(`${prefix(channel)} Build ${kind}${location}.`)
      inBlock = true
      continue
    }

    if (inBlock && plain.trim().length > 0) {
      wrapped.push(`  ${line}`)
      continue
    }

    wrapped.push(line)
  }

  return wrapped.join('\n')
}

export function renderStatsBlocks(
  stats: StatsToStringLike,
  opts: {errors: boolean; warnings: boolean}
): string {
  const raw = stats.toString({
    colors: true,
    all: false,
    errors: opts.errors,
    warnings: opts.warnings
  })
  if (!raw) return ''
  return wrapStatsBlocks(scrubBrand(raw))
}

export function handleStatsErrors(stats: import('@rspack/core').Stats): void {
  try {
    const verbose = String(process.env.EXTENSION_VERBOSE || '').trim() === '1'

    const str = renderStatsBlocks(stats, {errors: true, warnings: !!verbose})

    if (str) console.error(str)
  } catch {
    try {
      const str = renderStatsBlocks(stats, {errors: true, warnings: true})
      if (str) console.error(str)
    } catch {
      // Ignore if stats.toString fails
    }
  }
}
