import {describe, it, expect} from 'vitest'

// Catalog snapshot for the `messages.ts` user-facing string catalog under
// programs/create. Pins the EXPORT SURFACE — message names and their
// arity/kind — so an unintended addition, removal, rename, or signature change
// of any user-facing message fails loudly in review. It does not render the
// strings (that needs per-message args + would couple the snapshot to
// ANSI/env), keeping it deterministic. Discovery is glob-based. Update
// intentionally with `vitest -u`.
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
    const key = path.replace(/^(\.\.\/)+/, '')
    catalog[key] = Object.entries(mods[path])
      .map(([name, value]) => `${name}: ${describeExport(value)}`)
      .sort()
  }
  return catalog
}

describe('create message catalogs', () => {
  it('discovers the message catalogs in this package', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0)
  })

  it('matches the exported message surface', () => {
    expect(buildCatalog(modules)).toMatchSnapshot()
  })
})
