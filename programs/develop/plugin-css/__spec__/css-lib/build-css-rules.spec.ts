import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../../common-style-loaders', () => ({
  commonStyleLoaders: vi.fn(async () => [])
}))

import {buildCssRules} from '../../css-lib/build-css-rules'

const opts = {
  nonModuleType: 'css' as const,
  issuer: () => true
}

function rulesFor(rules: any[], ext: string) {
  return rules.filter((r) => r.test.test(`file.${ext}`))
}

function hasPassthrough(rule: any) {
  return (rule.use as any[]).some((u) =>
    String(u?.loader || u).includes('preprocessor-passthrough-loader')
  )
}

describe('buildCssRules — missing-preprocessor passthrough (bug 26)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('attaches the warn-loudly passthrough loader to scss/less rules when the compilers are absent', async () => {
    const rules = (await buildCssRules(
      '/project',
      'development',
      {useSass: false, useLess: false},
      opts
    )) as any[]

    for (const ext of ['scss', 'sass', 'less']) {
      const matching = rulesFor(rules, ext)
      expect(matching.length).toBeGreaterThan(0)
      for (const rule of matching) {
        expect(hasPassthrough(rule)).toBe(true)
      }
    }

    // Preprocessor files still route as CSS (Chrome parity), never to the
    // default JS parser.
    expect(
      rulesFor(rules, 'scss').every(
        (r) => r.type === 'css' || r.type === 'css/module'
      )
    ).toBe(true)
  })

  it('does NOT attach the passthrough loader when the compilers are installed', async () => {
    const rules = (await buildCssRules(
      '/project',
      'development',
      {useSass: true, useLess: true},
      opts
    )) as any[]

    for (const rule of rules) {
      expect(hasPassthrough(rule)).toBe(false)
    }
  })

  it('plain .css rules never get the passthrough loader', async () => {
    const rules = (await buildCssRules(
      '/project',
      'development',
      {useSass: false, useLess: false},
      opts
    )) as any[]

    for (const rule of rulesFor(rules, 'css')) {
      expect(hasPassthrough(rule)).toBe(false)
    }
  })
})
