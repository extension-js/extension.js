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

  it('returns asset rules with generator and content-script issuer', async () => {
    const projectPath = '/project'
    const manifestPath = '/project/manifest.json'
    const mode = 'development' as const

    const rules = await cssInContentScriptLoader(
      projectPath,
      manifestPath,
      mode
    )

    expect(Array.isArray(rules)).toBe(true)
    for (const rule of rules as any[]) {
      expect(rule.type).toBe('asset')
      expect(rule.generator?.filename).toContain('content_scripts')
      expect(typeof rule.issuer).toBe('function')
      expect((rule.use as any[])?.length).toBeGreaterThan(0)
    }
  })
})

