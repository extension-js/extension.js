import {describe, it, expect} from 'vitest'

// Catalog snapshot for every `messages.ts` user-facing string catalog under
// programs/develop. This pins the EXPORT SURFACE of each catalog — the set of
// message names and their arity/kind — so an unintended addition, removal,
// rename, or signature change of any user-facing message fails loudly in
// review. It deliberately does not render the strings (that needs per-message
// args + would couple the snapshot to ANSI/env), so the snapshot stays
// deterministic. Discovery is glob-based: drop a new `messages.ts` anywhere in
// this package and it joins the snapshot automatically. Update intentionally
// with `vitest -u`.
const modules = import.meta.glob(
  ['../**/messages.ts', '!../**/node_modules/**', '!../**/dist/**'],
  {eager: true}
) as Record<string, Record<string, unknown>>

function describeExport(value: unknown): string {
  if (typeof value === 'function') return `function(${value.length})`
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object' && value !== null) return 'object'
  return typeof value
}

function buildCatalog(
  mods: Record<string, Record<string, unknown>>
): Record<string, string[]> {
  const catalog: Record<string, string[]> = {}
  for (const path of Object.keys(mods).sort()) {
    // Normalize to a package-relative key so the snapshot does not encode the
    // spec file's own location.
    const key = path.replace(/^(\.\.\/)+/, '')
    catalog[key] = Object.entries(mods[path])
      .map(([name, value]) => `${name}: ${describeExport(value)}`)
      .sort()
  }
  return catalog
}

describe('develop message catalogs', () => {
  it('discovers the message catalogs in this package', () => {
    // Guards against a glob that silently matches nothing (which would make
    // the snapshot below vacuously pass).
    expect(Object.keys(modules).length).toBeGreaterThan(0)
  })

  it('matches the exported message surface', () => {
    expect(buildCatalog(modules)).toMatchSnapshot()
  })
})
