// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {scrubBrand} from './branding'
import {isDebug, prefix} from './messaging'

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

export interface StatsToStringLike {
  toString: (options?: {
    colors?: boolean
    all?: boolean
    errors?: boolean
    warnings?: boolean
  }) => string
  toJson?: (options?: {all?: boolean; warnings?: boolean}) => {
    warnings?: Array<{code?: unknown; message?: unknown}>
  }
}

// These warnings already printed on the human channel at the moment the
// plugin acted, so the stats render skips them to keep one visible line each.
const EMIT_TIME_WARNING_CODES = new Set([
  'ManifestFatalShapeWarning',
  'ManifestLegacyWarning'
])

export function isEmitTimeWarning(
  warning: {code?: unknown} | string | null | undefined
): boolean {
  if (!warning || typeof warning === 'string') return false
  return EMIT_TIME_WARNING_CODES.has(String(warning.code || ''))
}

function collectEmitTimeWarningTexts(stats: StatsToStringLike): Set<string> {
  const texts = new Set<string>()
  try {
    const warnings = stats.toJson?.({all: false, warnings: true})?.warnings
    for (const warning of warnings || []) {
      if (!isEmitTimeWarning(warning)) continue
      const text = String(warning?.message ?? '')
        .replace(ANSI_PATTERN, '')
        .trim()
      if (text) texts.add(text)
    }
  } catch {
    // Ignore
  }
  return texts
}

function dropEmitTimeWarningBlocks(raw: string, excluded: Set<string>): string {
  if (excluded.size === 0) return raw

  const kept: string[] = []
  let block: string[] | null = null

  const flush = () => {
    if (!block) return
    const body = block
      .slice(1)
      .map((line) => line.replace(ANSI_PATTERN, ''))
      .join('\n')
      .trim()
    if (!excluded.has(body)) kept.push(...block)
    block = null
  }

  for (const line of String(raw).split('\n')) {
    const plain = line.replace(ANSI_PATTERN, '')
    if (/^WARNING(?: in .+)?$/.test(plain)) {
      flush()
      block = [line]
      continue
    }
    if (/^ERROR(?: in .+)?$/.test(plain)) {
      flush()
      kept.push(line)
      continue
    }
    if (block) {
      block.push(line)
      continue
    }
    kept.push(line)
  }
  flush()

  return kept.join('\n')
}

const CASE_MISMATCH_PATTERN =
  /\[CaseSensitivePathsPlugin\]\s*`([^`]+)`\s*does not match the corresponding path on disk\s*`?([^`\s]+?)`?\.?\s*$/

// A casing mismatch is a user-facing refusal, not a plugin crash. Collapse
// the plugin's stack to one clear line and keep the frames for author mode.
export function humanizeCaseMismatchBlocks(
  raw: string,
  showStack: boolean = isDebug()
): string {
  const lines = String(raw || '').split('\n')
  const out: string[] = []
  let droppingStack = false

  for (const line of lines) {
    const plain = line.replace(ANSI_PATTERN, '')
    const match = CASE_MISMATCH_PATTERN.exec(plain)

    if (match) {
      const reference = match[1]
      const onDisk = match[2]
      out.push(
        `  × \`${reference}\` does not match its casing on disk: \`${onDisk}\`.`,
        `    Case-sensitive filesystems fail this reference. Rename the file or the import so both agree.`
      )
      droppingStack = !showStack
      continue
    }

    if (droppingStack) {
      if (plain.trim().startsWith('│')) continue
      droppingStack = false
    }

    out.push(line)
  }

  return out.join('\n')
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
  const filtered = opts.warnings
    ? dropEmitTimeWarningBlocks(raw, collectEmitTimeWarningTexts(stats))
    : raw
  if (!filtered.trim()) return ''
  return wrapStatsBlocks(scrubBrand(humanizeCaseMismatchBlocks(filtered)))
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
