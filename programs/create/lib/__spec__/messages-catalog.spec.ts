import {describe, expect, it} from 'vitest'

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
