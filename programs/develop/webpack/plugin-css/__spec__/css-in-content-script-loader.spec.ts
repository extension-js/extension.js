import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../common-style-loaders', () => ({
  commonStyleLoaders: vi.fn(async () => [{loader: 'mock-style-loader'}])
}))

vi.mock('../css-lib/is-content-script', () => ({
  isContentScriptEntry: vi.fn((_issuer: string) => true)
}))

import {cssInContentScriptLoader} from '../css-in-content-script-loader'

describe('cssInContentScriptLoader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns content-script rules and handles module CSS explicitly', async () => {
    const projectPath = '/project'
    const manifestPath = '/project/manifest.json'
    const mode = 'development' as const

    const rules = await cssInContentScriptLoader(
      projectPath,
      manifestPath,
      mode
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

    for (const rule of rules as any[]) {
      expect(['asset', 'css/module']).toContain(rule.type)
      if (rule.type === 'asset') {
        expect(rule.generator?.filename).toContain('content_scripts')
      }
      expect(typeof rule.issuer).toBe('function')
      expect((rule.use as any[])?.length).toBeGreaterThan(0)
    }
  })
})
