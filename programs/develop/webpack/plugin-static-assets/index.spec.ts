import {describe, it, expect} from 'vitest'
import {StaticAssetsPlugin} from './index'

type AnyRule = {
  test?: RegExp
  type?: string
  use?: unknown
  parser?: {
    dataUrlCondition?: {maxSize?: number}
  }
  generator?: {filename?: string}
}

function createCompiler(initialRules: AnyRule[] = []) {
  return {
    options: {
      module: {
        rules: [...initialRules]
      }
    }
  } as any
}

function findRulesMatching(
  rules: AnyRule[],
  fileName: string,
  predicate?: (r: AnyRule) => boolean
) {
  return rules
    .filter((r) => r?.test instanceof RegExp && r.test.test(fileName))
    .filter((r) => (predicate ? predicate(r) : true))
}

describe('StaticAssetsPlugin (unit)', () => {
  it('exposes a stable plugin name', () => {
    // The plugin exposes a static name used by integrators
    expect((StaticAssetsPlugin as any).name).toBe('plugin-static-assets')
  })

  it('adds default SVG rule when no custom svg rule with use[] exists', async () => {
    const compiler = createCompiler()
    const plugin = new StaticAssetsPlugin({
      mode: 'development',
      manifestPath: '/abs/manifest.json'
    })
    await plugin.apply(compiler as any)

    const rules = (compiler as any).options.module.rules as AnyRule[]
    const svgAssetRules = findRulesMatching(
      rules,
      'file.svg',
      (r) => r.type === 'asset' && r.use === undefined
    )
    expect(svgAssetRules.length).toBe(1)
    const svg = svgAssetRules[0]!
    expect(svg.generator?.filename).toBe('assets/[name][ext]')
    expect(svg.parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)
  })

  it('does not add default SVG rule if a custom svg rule with use[] exists', async () => {
    const customSvgRule: AnyRule = {test: /\.svg$/i, use: ['custom-loader']}
    const compiler = createCompiler([customSvgRule])
    const plugin = new StaticAssetsPlugin({
      mode: 'development',
      manifestPath: '/abs/manifest.json'
    })
    await plugin.apply(compiler as any)

    const rules = (compiler as any).options.module.rules as AnyRule[]
    // There should be no additional svg rule of type asset (only the custom one we provided)
    const svgAssetRules = findRulesMatching(
      rules,
      'file.svg',
      (r) => r.type === 'asset'
    )
    expect(svgAssetRules.length).toBe(0)

    // Ensure our original custom rule remains
    const svgRules = findRulesMatching(rules, 'file.svg')
    expect(svgRules.some((r) => r.use)).toBe(true)
  })

  it('adds image, font, and misc file rules with dev filename pattern', async () => {
    const compiler = createCompiler()
    const plugin = new StaticAssetsPlugin({
      mode: 'development',
      manifestPath: '/abs/manifest.json'
    })
    await plugin.apply(compiler as any)

    const rules = (compiler as any).options.module.rules as AnyRule[]
    const imgRule = findRulesMatching(rules, 'photo.png')[0]
    const fontRule = findRulesMatching(rules, 'font.woff2')[0]
    const miscRule = findRulesMatching(rules, 'doc.pdf')[0]

    expect(imgRule?.type).toBe('asset')
    expect(imgRule?.generator?.filename).toBe('assets/[name][ext]')
    expect(imgRule?.parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)

    expect(fontRule?.type).toBe('asset')
    expect(fontRule?.generator?.filename).toBe('assets/[name][ext]')

    expect(miscRule?.type).toBe('asset')
    expect(miscRule?.generator?.filename).toBe('assets/[name][ext]')
    expect(miscRule?.parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)
  })

  it('uses contenthash filename pattern in production', async () => {
    const compiler = createCompiler()
    const plugin = new StaticAssetsPlugin({
      mode: 'production',
      manifestPath: '/abs/manifest.json'
    })
    await plugin.apply(compiler as any)

    const rules = (compiler as any).options.module.rules as AnyRule[]
    const imgRule = findRulesMatching(rules, 'photo.png')[0]
    const svgRule = findRulesMatching(
      rules,
      'icon.svg',
      (r) => r.type === 'asset' && r.use === undefined
    )[0]
    const miscRule = findRulesMatching(rules, 'doc.pdf')[0]

    expect(imgRule?.generator?.filename).toBe(
      'assets/[name].[contenthash:8][ext]'
    )
    expect(svgRule?.generator?.filename).toBe(
      'assets/[name].[contenthash:8][ext]'
    )
    expect(miscRule?.generator?.filename).toBe(
      'assets/[name].[contenthash:8][ext]'
    )
  })

  it('preserves existing rules and filters out falsey entries', async () => {
    const keptRule: AnyRule = {test: /\.keep$/i, type: 'asset'}
    const compiler = createCompiler([
      keptRule,
      undefined as unknown as AnyRule,
      null as unknown as AnyRule
    ])
    const plugin = new StaticAssetsPlugin({
      mode: 'development',
      manifestPath: '/abs/manifest.json'
    })
    await plugin.apply(compiler as any)

    const rules = (compiler as any).options.module.rules as AnyRule[]
    // Our kept rule should still be there
    expect(
      rules.some((r) => r?.test instanceof RegExp && r.test.test('x.keep'))
    ).toBe(true)
    // No falsey values should remain
    expect(rules.every(Boolean)).toBe(true)
  })
})
