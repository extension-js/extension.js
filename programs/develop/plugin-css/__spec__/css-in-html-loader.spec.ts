import {beforeEach, describe, expect, it, vi} from 'vitest'
import {NOT_RAW_RESOURCE_QUERY} from '../../lib/resource-query'

vi.mock('../common-style-loaders', () => ({
  commonStyleLoaders: vi.fn(async () => [{loader: 'mock-style-loader'}])
}))

import {cssInHtmlLoader} from '../css-in-html-loader'

describe('cssInHtmlLoader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns css and css/module types and the content-script layer is excluded', async () => {
    const projectPath = '/project'
    const mode = 'development' as const
    const manifestPath = '/project/manifest.json'

    const rules = await cssInHtmlLoader(projectPath, mode, manifestPath)

    expect(Array.isArray(rules)).toBe(true)
    expect(rules.some((r: any) => r.type === 'css')).toBe(true)
    expect(rules.some((r: any) => r.type === 'css/module')).toBe(true)
    expect(
      rules.some(
        (r: any) =>
          String(r.test) === String(/\.module\.css$/) && r.type === 'css/module'
      )
    ).toBe(true)

    expect(
      rules.some(
        (r: any) =>
          String(r.test) === String(/\.css$/) &&
          String(r.exclude) === String(/\.module\.css$/) &&
          r.type === 'css'
      )
    ).toBe(true)

    for (const rule of rules as any[]) {
      // A ?raw import of a stylesheet is the file text, never a compiled sheet.
      expect(rule.resourceQuery).toEqual(NOT_RAW_RESOURCE_QUERY)
      expect(rule.resourceQuery.not[0].test('?raw')).toBe(true)
      const pageRule =
        JSON.stringify(rule.issuerLayer) ===
          JSON.stringify({not: 'extensionjs-content-script'}) &&
        rule.issuer === undefined
      const declaredContentRule =
        rule.issuerLayer === 'extensionjs-content-script' &&
        String(rule.issuer?.not) === String(/./)
      expect(pageRule || declaredContentRule).toBe(true)
      expect((rule.use as any[])?.length).toBeGreaterThan(0)
    }
  })
})
