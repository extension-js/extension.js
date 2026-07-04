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
          r.type === 'asset/inline'
      )
    ).toBe(true)

    for (const rule of rules as any[]) {
      expect(['asset/inline', 'css/module']).toContain(rule.type)
      // Regression guard: `resourceQuery: {not: [/url/]}` used to silently
      // bypass PostCSS for `?url` imports, shipping raw CSS (including
      // uncompiled `@import "tailwindcss"`). The rule must cover every
      // CSS specifier the issuer can produce — no query-string escape hatch.
      expect(rule.resourceQuery).toBeUndefined()
      expect(typeof rule.issuer).toBe('function')
      expect((rule.use as any[])?.length).toBeGreaterThan(0)
    }
  })

  it('still routes .scss/.less as CSS when the preprocessor is not installed (G23)', async () => {
    // Chrome loads a manifest-declared .scss stylesheet by injecting its raw
    // text as CSS. With no rule for the extension, the file fell through to
    // rspack's default JS parser and hard-failed a build the browser accepts.
    const rules = await cssInContentScriptLoader(
      '/project',
      '/project/manifest.json',
      'development',
      {useSass: false, useLess: false}
    )

    const scssRule: any = (rules as any[]).find(
      (r) =>
        String(r.test) === String(/\.(sass|scss)$/) &&
        r.type === 'asset/inline'
    )
    expect(scssRule).toBeDefined()
    // Must NOT use sass-loader (it is not installed) — plain CSS chain only.
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
