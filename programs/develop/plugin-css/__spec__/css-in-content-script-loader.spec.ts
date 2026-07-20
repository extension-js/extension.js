import {beforeEach, describe, expect, it, vi} from 'vitest'

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
          r.type === 'asset/inline'
      )
    ).toBe(true)

    for (const rule of rules as any[]) {
      expect(['asset/inline', 'css/module']).toContain(rule.type)
      expect(rule.resourceQuery).toBeUndefined()
      expect(typeof rule.issuer).toBe('function')
      expect((rule.use as any[])?.length).toBeGreaterThan(0)
    }
  })

  it('still routes .scss/.less as CSS when the preprocessor is not installed (G23)', async () => {
    const rules = await cssInContentScriptLoader(
      '/project',
      '/project/manifest.json',
      'development',
      {useSass: false, useLess: false}
    )

    const scssRule: any = (rules as any[]).find(
      (r) =>
        String(r.test) === String(/\.(sass|scss)$/) && r.type === 'asset/inline'
    )
    expect(scssRule).toBeDefined()
    expect(
      (scssRule.use as any[]).some((u) =>
        String(u?.loader || u).includes('sass-loader')
      )
    ).toBe(false)

    const lessRule: any = (rules as any[]).find(
      (r) => String(r.test) === String(/\.less$/) && r.type === 'asset/inline'
    )
    expect(lessRule).toBeDefined()
  })
})
