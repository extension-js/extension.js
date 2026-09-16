// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

export function normalizeResourcePath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((segment) => escapeRegex(segment))
    .join('.*')

  return new RegExp(`^${escaped}$`)
}

// A declared entry covers a file when it names it or when its glob matches.
export function isResourceCovered(
  declared: readonly string[],
  candidate: string
): boolean {
  const target = normalizeResourcePath(candidate)

  for (const entry of declared) {
    const pattern = normalizeResourcePath(entry)
    if (pattern === target) return true

    if (pattern.includes('*')) {
      try {
        if (globToRegex(pattern).test(target)) return true
      } catch {
        // A pattern we cannot compile simply covers nothing
      }
    }
  }

  return false
}

// Names passed to runtime.getURL as a plain string. A computed name cannot be
// read here, so a miss stays silent rather than guessing at a wrong file.
export const GET_URL_LITERAL_PATTERN =
  /getURL\s*\(\s*["'`]([^"'`\n)]+)["'`]\s*\)/g

// A bundle past this size is a payload, not hand-written glue, and scanning
// it on every watch rebuild would cost more than the diagnostic is worth.
const MAX_SCANNED_SOURCE_BYTES = 4 * 1024 * 1024

export function collectGetUrlLiterals(source: string): string[] {
  if (!source || source.length > MAX_SCANNED_SOURCE_BYTES) return []

  const found = new Set<string>()
  const pattern = new RegExp(GET_URL_LITERAL_PATTERN.source, 'g')
  let match = pattern.exec(source)

  while (match) {
    const name = normalizeResourcePath(match[1])
    // A template hole means the name is computed, so the file it names is
    // unknown at build time and no honest warning can point at one.
    if (name && !name.includes('${')) found.add(name)

    match = pattern.exec(source)
  }

  return Array.from(found).sort()
}

// Files the dev instrumentation itself reaches for. They are ours, not the
// author's, and dev lists what they need, so they never warrant a warning.
const TOOLING_RESOURCES = new Set([
  'manifest.json',
  'extension-js-control.json'
])

// The files a page-context bundle asks the extension origin for that the
// manifest never makes page-reachable. Chrome answers those with a
// SecurityError at runtime, in development exactly as in production.
export function findUnreachableRuntimeResources(options: {
  source: string
  emittedAssetNames: readonly string[]
  declaredResources: readonly string[]
}): string[] {
  const emitted = new Set(
    options.emittedAssetNames.map((name) => normalizeResourcePath(name))
  )

  return collectGetUrlLiterals(options.source).filter((name) => {
    if (TOOLING_RESOURCES.has(name)) return false
    if (name.startsWith('hot/')) return false
    if (!emitted.has(name)) return false

    return !isResourceCovered(options.declaredResources, name)
  })
}
