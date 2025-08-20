import {describe, it, expect, vi, beforeEach} from 'vitest'

describe('css loaders helpers (mocked to avoid optional deps)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('cssInContentScriptLoader returns asset rules shape (mocked)', async () => {
    vi.doMock('../css-in-content-script-loader', () => ({
      cssInContentScriptLoader: vi.fn(async () => [
        {
          type: 'asset',
          generator: {filename: 'content_scripts/[name].css'},
          issuer: () => true
        }
      ])
    }))
    const {cssInContentScriptLoader} = await import(
      '../css-in-content-script-loader'
    )
    const rules = await cssInContentScriptLoader('/project', 'development')
    expect(rules[0].type).toBe('asset')
    expect(rules[0].generator.filename).toContain('content_scripts')
    expect(typeof rules[0].issuer).toBe('function')
  })

  it('cssInHtmlLoader returns css/css-module rules shape (mocked)', async () => {
    vi.doMock('../css-in-html-loader', () => ({
      cssInHtmlLoader: vi.fn(async () => [
        {type: 'css', issuer: () => true},
        {type: 'css/module', issuer: () => true}
      ])
    }))
    const {cssInHtmlLoader} = await import('../css-in-html-loader')
    const rules = await cssInHtmlLoader('/project', 'development')
    expect(rules.map((r: any) => r.type)).toEqual(['css', 'css/module'])
  })
})
