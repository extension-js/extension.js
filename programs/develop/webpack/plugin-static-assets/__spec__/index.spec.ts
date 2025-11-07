import {describe, it, expect, vi, beforeEach} from 'vitest'
import {StaticAssetsPlugin} from '../index'

function createCompiler() {
  return {
    options: {
      mode: 'development',
      module: {rules: [] as any[]},
      resolve: {alias: {} as Record<string, string>}
    }
  } as any
}

function findRuleByTest(rules: any[], regex: RegExp) {
  return rules.find(
    (r) => r?.test instanceof RegExp && String(r.test) === String(regex)
  )
}

describe('StaticAssetsPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds default asset rules with development filenames and SVG inline threshold', async () => {
    const compiler = createCompiler()
    const plugin = new StaticAssetsPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })

    await plugin.apply(compiler)

    const rules = compiler.options.module.rules as any[]

    const svgRule = findRuleByTest(rules, /\.svg$/i)
    expect(svgRule).toBeTruthy()
    expect(svgRule.type).toBe('asset')
    expect(svgRule.generator?.filename).toBe('assets/[name][ext]')
    expect(svgRule.parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)

    const imagesRule = findRuleByTest(
      rules,
      /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp)$/i
    )
    expect(imagesRule).toBeTruthy()
    expect(imagesRule.type).toBe('asset')
    expect(imagesRule.generator?.filename).toBe('assets/[name][ext]')
    expect(imagesRule.parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)

    const fontsRule = findRuleByTest(rules, /\.(woff|woff2|eot|ttf|otf)$/i)
    expect(fontsRule).toBeTruthy()
    expect(fontsRule.type).toBe('asset')
    expect(fontsRule.generator?.filename).toBe('assets/[name][ext]')

    const filesRule = findRuleByTest(
      rules,
      /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i
    )
    expect(filesRule).toBeTruthy()
    expect(filesRule.type).toBe('asset')
    expect(filesRule.generator?.filename).toBe('assets/[name][ext]')
    expect(filesRule.parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)
  })

  it('uses production filenames with contenthash in production mode', async () => {
    const compiler = createCompiler()
    const plugin = new StaticAssetsPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'production'
    })

    await plugin.apply(compiler)
    const rules = compiler.options.module.rules as any[]

    const svgRule = findRuleByTest(rules, /\.svg$/i)
    const imagesRule = findRuleByTest(
      rules,
      /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp)$/i
    )
    const fontsRule = findRuleByTest(rules, /\.(woff|woff2|eot|ttf|otf)$/i)
    const filesRule = findRuleByTest(
      rules,
      /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i
    )

    for (const rule of [svgRule, imagesRule, fontsRule, filesRule]) {
      expect(rule.generator?.filename).toBe(
        'assets/[name].[contenthash:8][ext]'
      )
    }
  })

  it('respects existing custom SVG rule (does not add default svg asset rule)', async () => {
    const compiler = createCompiler()
    // Add a custom SVG rule with a loader (`use` present)
    compiler.options.module.rules.push({
      test: /\.svg$/i,
      use: [{loader: 'custom-svg-loader'}]
    })

    const plugin = new StaticAssetsPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })
    await plugin.apply(compiler)

    const rules = compiler.options.module.rules as any[]
    // Ensure our original custom rule is present
    const svgRules = rules.filter(
      (r) => r?.test instanceof RegExp && String(r.test) === String(/\.svg$/i)
    )
    expect(svgRules.length).toBe(1)
    expect(svgRules[0].use).toBeDefined()
    // And that no default asset-type svg rule was added
    expect(svgRules[0].type).toBeUndefined()
  })
})
