import * as fs from 'node:fs'
import * as path from 'node:path'
import {beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('../../common-style-loaders', () => ({
  commonStyleLoaders: vi.fn(async () => [])
}))

import {commonStyleLoaders} from '../../common-style-loaders'
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

describe('buildCssRules, missing-preprocessor passthrough (bug 26)', () => {
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

// A bare "sass-loader" is looked up through resolveLoader.modules, which stops
// at extension-develop's parent. A project outside a hoisted checkout then
// fails with "Unable to resolve loader sass-loader" although the package is
// installed. The rule carries the absolute file instead, as vue and postcss do.
describe('buildCssRules, preprocessor loader paths', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hands rspack absolute sass-loader and less-loader files, never bare names', async () => {
    await buildCssRules(
      '/project',
      'development',
      {useSass: true, useLess: true},
      opts
    )

    const loaders = vi
      .mocked(commonStyleLoaders)
      .mock.calls.map(([, styleOpts]) => styleOpts.loader)
      .filter((loader): loader is string => typeof loader === 'string')

    expect(loaders.some((loader) => loader.includes('sass-loader'))).toBe(true)
    expect(loaders.some((loader) => loader.includes('less-loader'))).toBe(true)

    for (const loader of loaders) {
      expect(path.isAbsolute(loader), loader).toBe(true)
      expect(fs.statSync(loader).isFile(), loader).toBe(true)
    }
  })
})
