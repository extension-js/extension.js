import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../common-style-loaders', () => ({
  commonStyleLoaders: vi.fn(async () => [{loader: 'mock-style-loader'}])
}))

vi.mock('../css-lib/is-content-script', () => ({
  isContentScriptEntry: vi.fn((issuer: string) => issuer.includes('content'))
}))

import {cssInHtmlLoader} from '../css-in-html-loader'

describe('cssInHtmlLoader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns css and css/module types and issuer excludes content scripts', async () => {
    const projectPath = '/project'
    const mode = 'development' as const
    const manifestPath = '/project/manifest.json'

    const rules = await cssInHtmlLoader(projectPath, mode, manifestPath)

    expect(Array.isArray(rules)).toBe(true)
    expect(rules.some((r: any) => r.type === 'css')).toBe(true)
    expect(rules.some((r: any) => r.type === 'css/module')).toBe(true)

    for (const rule of rules as any[]) {
      expect(typeof rule.issuer).toBe('function')
      expect(rule.issuer('content.js')).toBe(false)
      expect((rule.use as any[])?.length).toBeGreaterThan(0)
    }
  })
})
