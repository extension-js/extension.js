import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../common-style-loaders', () => ({
  commonStyleLoaders: vi.fn(async () => [{loader: 'mock-style-loader'}])
}))

vi.mock('../css-lib/is-content-script', () => ({
  isContentScriptEntry: vi.fn((issuer: string) => issuer.includes('content'))
}))

import {cssInContentScriptLoader} from '../css-in-content-script-loader'
import {cssInHtmlLoader} from '../css-in-html-loader'

describe('cssInContentScriptLoader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rules with asset type and generator for content scripts', async () => {
    const rules = await cssInContentScriptLoader('/project', 'development')
    expect(Array.isArray(rules)).toBe(true)
    for (const rule of rules) {
      expect(rule.type).toBe('asset')
      expect(rule.generator?.filename).toContain('content_scripts')
      expect(typeof rule.issuer).toBe('function')
      expect((rule.use as any[])?.length).toBeGreaterThan(0)
    }
  })
})

describe('cssInHtmlLoader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rules with css types and not content script issuer', async () => {
    const rules = await cssInHtmlLoader('/project', 'development')
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

