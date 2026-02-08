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
