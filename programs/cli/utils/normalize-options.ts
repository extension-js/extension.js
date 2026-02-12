// ███╗   ██╗ ██████╗ ██████╗ ███╗   ███╗ █████╗ ██╗     ██╗███████╗███████╗
// ████╗  ██║██╔═══██╗██╔══██╗████╗ ████║██╔══██╗██║     ██║██╔════╝██╔════╝
// ██╔██╗ ██║██║   ██║██████╔╝██╔████╔██║███████║██║     ██║███████╗█████╗
// ██║╚██╗██║██║   ██║██╔══██╗██║╚██╔╝██║██╔══██║██║     ██║╚════██║██╔══╝
// ██║ ╚████║╚██████╔╝██║  ██║██║ ╚═╝ ██║██║  ██║███████╗██║███████║███████╗
// ╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

export function normalizeSourceOption(
  source: boolean | string | undefined,
  startingUrl?: string
): string | undefined {
  if (!source) return undefined

  const hasExplicitSourceString =
    typeof source === 'string' && String(source).trim().toLowerCase() !== 'true'

  const hasStartingUrl =
    typeof startingUrl === 'string' && String(startingUrl).trim().length > 0

  if (!hasExplicitSourceString) {
    return hasStartingUrl ? String(startingUrl) : 'https://example.com'
  }

  return String(source)
}

export type SourceFormat = 'pretty' | 'json' | 'ndjson'
export type SourceRedact = 'off' | 'safe' | 'strict'
export type SourceIncludeShadow = 'off' | 'open-only' | 'all'
export type SourceTreeMode = 'off' | 'root-only'
export type SourceDomMode = 'off' | 'on'

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | undefined {
  if (typeof value === 'undefined' || value === null) return undefined

  const normalized = String(value).trim().toLowerCase()

  if (!normalized) return undefined

  return (allowed as readonly string[]).includes(normalized)
    ? (normalized as T)
    : undefined
}

export function normalizeSourceFormatOption(params: {
  sourceFormat?: string
  logFormat?: string
  sourceEnabled?: boolean
}): SourceFormat | undefined {
  const allowed = ['pretty', 'json', 'ndjson'] as const
  const sourceFormat = normalizeEnum(params.sourceFormat, allowed)

  if (sourceFormat) return sourceFormat

  const logFormat = normalizeEnum(params.logFormat, allowed)
  if (logFormat) return logFormat

  if (params.sourceEnabled) return 'json'
  return undefined
}

export function normalizeSourceRedactOption(
  sourceRedact: string | undefined,
  sourceFormat: SourceFormat | undefined
): SourceRedact {
  const allowed = ['off', 'safe', 'strict'] as const
  const normalized = normalizeEnum(sourceRedact, allowed)

  if (normalized) return normalized

  if (sourceFormat && sourceFormat !== 'pretty') return 'safe'

  return 'off'
}

export function normalizeSourceMaxBytesOption(
  value: string | number | undefined
): number | undefined {
  if (typeof value === 'undefined' || value === null) return undefined

  const parsed =
    typeof value === 'number' ? value : Number(String(value).trim())

  if (!Number.isFinite(parsed) || parsed < 0) return undefined

  return Math.floor(parsed)
}

export function normalizeSourceIncludeShadowOption(
  value: string | undefined,
  sourceEnabled: boolean
): SourceIncludeShadow | undefined {
  const allowed = ['off', 'open-only', 'all'] as const
  const normalized = normalizeEnum(value, allowed)

  if (normalized) return normalized
  if (sourceEnabled) return 'open-only'

  return undefined
}

export function normalizeSourceMetaOption(
  value: boolean | string | undefined,
  sourceEnabled: boolean
): boolean | undefined {
  if (typeof value !== 'undefined') {
    return String(value).trim().length === 0 ? true : Boolean(value)
  }
  if (sourceEnabled) return true
  return undefined
}

export function normalizeSourceTreeOption(
  value: string | undefined,
  sourceEnabled: boolean
): SourceTreeMode | undefined {
  const allowed = ['off', 'root-only'] as const
  const normalized = normalizeEnum(value, allowed)

  if (normalized) return normalized
  if (sourceEnabled) return undefined

  return undefined
}

export function normalizeSourceConsoleOption(
  value: boolean | string | undefined,
  sourceEnabled: boolean
): boolean | undefined {
  if (typeof value !== 'undefined') {
    return String(value).trim().length === 0 ? true : Boolean(value)
  }

  if (sourceEnabled) return undefined

  return undefined
}

export function normalizeSourceDomOption(
  value: boolean | string | undefined,
  watchSource: boolean | undefined
): boolean | undefined {
  if (typeof value !== 'undefined') {
    return String(value).trim().length === 0 ? true : Boolean(value)
  }

  if (watchSource) return true

  return undefined
}

export function normalizeSourceProbeOption(
  raw: string | string[] | undefined
): string[] | undefined {
  if (typeof raw === 'undefined' || raw === null) return undefined

  if (Array.isArray(raw)) {
    const values = raw
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0)
    return values.length > 0 ? values : undefined
  }

  if (String(raw).trim().length === 0) return undefined

  const values = String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return values.length > 0 ? values : undefined
}

export function normalizeSourceDiffOption(
  value: boolean | string | undefined,
  watchSource: boolean | undefined
): boolean | undefined {
  if (typeof value !== 'undefined') {
    return String(value).trim().length === 0 ? true : Boolean(value)
  }

  if (watchSource) return true

  return undefined
}

export function parseLogContexts(
  raw: string | undefined
):
  | Array<
      | 'background'
      | 'content'
      | 'page'
      | 'sidebar'
      | 'popup'
      | 'options'
      | 'devtools'
    >
  | undefined {
  if (!raw || String(raw).trim().length === 0) return undefined
  if (String(raw).trim().toLowerCase() === 'all') return undefined

  const allowed = [
    'background',
    'content',
    'page',
    'sidebar',
    'popup',
    'options',
    'devtools'
  ] as const

  type Context = (typeof allowed)[number]

  const values = String(raw)
    .split(',')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0)
    .filter((c: string): c is Context =>
      (allowed as readonly string[]).includes(c)
    )

  return values.length > 0 ? values : undefined
}

export function parseExtensionsList(raw: string | undefined) {
  if (!raw || String(raw).trim().length === 0) return undefined

  const values = String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return values.length > 0 ? values : undefined
}
