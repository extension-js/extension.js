import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

vi.mock('../common-style-loaders', () => ({
  commonStyleLoaders: vi.fn(async () => [{loader: 'mock-style-loader'}])
}))

vi.mock('../css-lib/is-content-script', () => ({
  isContentScriptEntry: vi.fn((issuer: string) => issuer.includes('content'))
}))

vi.mock('../css-lib/integrations', async () => {
  const actual = await vi.importActual<any>('../css-lib/integrations')
  return {
    ...actual,
    resolveDevelopInstallRoot: vi.fn(() => '/extension-root')
  }
})

import {cssInContentScriptLoader} from '../css-in-content-script-loader'
import {cssInHtmlLoader} from '../css-in-html-loader'

describe('cssInContentScriptLoader', () => {
  const originalResolve = (require as any).resolve
  beforeEach(() => vi.clearAllMocks())

  afterEach(() => {
    ;(require as any).resolve = originalResolve
  })

  it('returns content-script rules and handles module CSS explicitly', async () => {
    const rules = await cssInContentScriptLoader(
      '/project',
      '/project/manifest.json',
      'development'
    )
    expect(Array.isArray(rules)).toBe(true)
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
          r.type === 'asset'
      )
    ).toBe(true)
    for (const rule of rules) {
      expect(['asset', 'css/module']).toContain((rule as any).type)
      if ((rule as any).type === 'asset') {
        expect((rule as any).generator?.filename).toContain('content_scripts')
      }
      expect(typeof rule.issuer).toBe('function')
      expect((rule.use as any[])?.length).toBeGreaterThan(0)
    }
  })

  it('resolves preprocessor loaders using project/runtime paths', async () => {
    await cssInContentScriptLoader(
      '/project',
      '/project/manifest.json',
      'development'
    )
    await cssInHtmlLoader('/project', 'development', '/project/manifest.json')

    const integrations = (await import('../css-lib/integrations')) as any
    expect(integrations.resolveDevelopInstallRoot).toHaveBeenCalled()
  })
})

describe('cssInHtmlLoader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rules with css types and not content script issuer', async () => {
    const rules = await cssInHtmlLoader(
      '/project',
      'development',
      '/project/manifest.json'
    )
    expect(Array.isArray(rules)).toBe(true)
    expect(rules.some((r: any) => r.type === 'css')).toBe(true)
    expect(rules.some((r: any) => r.type === 'css/module')).toBe(true)

    // Ensure issuer returns false for content-like issuer
    for (const rule of rules) {
      expect(typeof rule.issuer).toBe('function')
      // Our mocked isContentScriptEntry returns true when path contains 'content'
      // cssInHtmlLoader uses the negation (!isContentScriptEntry), so issuer('content.js') should be false
      expect(rule.issuer('content.js')).toBe(false)
      expect((rule.use as any[])?.length).toBeGreaterThan(0)
    }
  })
})
