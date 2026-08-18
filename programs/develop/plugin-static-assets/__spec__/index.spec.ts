import {beforeEach, describe, expect, it, vi} from 'vitest'
import {StaticAssetsPlugin} from '../index'

function createCompiler() {
  return {
    options: {
      mode: 'development',
      module: {rules: [] as any[]},
      resolve: {alias: {} as Record<string, string>}
    },
    hooks: {
      afterEmit: {
        tap: vi.fn()
      }
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

  it('content-hashes asset filenames in development and keeps the SVG inline threshold', async () => {
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
    expect(svgRule.generator?.filename).toBe(
      'assets/[name].[contenthash:8][ext]'
    )
    expect(svgRule.parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)

    const imagesRule = findRuleByTest(
      rules,
      /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp)$/i
    )
    expect(imagesRule).toBeTruthy()
    expect(imagesRule.type).toBe('asset')
    expect(imagesRule.generator?.filename).toBe(
      'assets/[name].[contenthash:8][ext]'
    )
    expect(imagesRule.parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)

    const fontsRule = findRuleByTest(rules, /\.(woff|woff2|eot|ttf|otf)$/i)
    expect(fontsRule).toBeTruthy()
    expect(fontsRule.type).toBe('asset')
    expect(fontsRule.generator?.filename).toBe(
      'assets/[name].[contenthash:8][ext]'
    )

    const filesRule = findRuleByTest(
      rules,
      /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i
    )
    expect(filesRule).toBeTruthy()
    expect(filesRule.type).toBe('asset')
    expect(filesRule.generator?.filename).toBe(
      'assets/[name].[contenthash:8][ext]'
    )
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
    const svgRules = rules.filter(
      (r) => r?.test instanceof RegExp && String(r.test) === String(/\.svg$/i)
    )
    expect(svgRules.length).toBe(1)
    expect(svgRules[0].use).toBeDefined()
    expect(svgRules[0].type).toBeUndefined()
  })

  it('respects existing custom fonts rule (does not add default fonts asset rule)', async () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.(woff|woff2|eot|ttf|otf)$/i,
      type: 'asset/inline'
    })

    const plugin = new StaticAssetsPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })
    await plugin.apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const fontRules = rules.filter(
      (r) =>
        r?.test instanceof RegExp &&
        String(r.test) === String(/\.(woff|woff2|eot|ttf|otf)$/i)
    )

    expect(fontRules.length).toBe(1)
    expect(fontRules[0].type).toBe('asset/inline')

    expect(
      findRuleByTest(rules, /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp)$/i)
    ).toBeTruthy()
    expect(
      findRuleByTest(
        rules,
        /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i
      )
    ).toBeTruthy()
  })

  it('lets a user image rule win for its extension and keeps the default for the siblings', async () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.png$/i,
      type: 'asset/resource'
    })

    await new StaticAssetsPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    }).apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const defaultImages = rules.filter(
      (r) =>
        r?.test instanceof RegExp &&
        r.generator?.filename === 'assets/[name].[contenthash:8][ext]' &&
        r.test.test('.jpg')
    )
    expect(defaultImages).toHaveLength(1)
    // The default image rule no longer claims .png at all, so last-wins can
    // never flip the user's asset/resource back to inline.
    expect(defaultImages[0].test.test('.png')).toBe(false)
    expect(defaultImages[0].test.test('.webp')).toBe(true)
    const pngRules = rules.filter(
      (r) => r?.test instanceof RegExp && r.test.test('.png')
    )
    expect(pngRules).toHaveLength(1)
    expect(pngRules[0].type).toBe('asset/resource')
  })

  it('lets a user documents rule win for its extension too', async () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.pdf$/i,
      type: 'asset/resource'
    })

    await new StaticAssetsPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    }).apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const pdfRules = rules.filter(
      (r) => r?.test instanceof RegExp && r.test.test('.pdf')
    )
    expect(pdfRules).toHaveLength(1)
    expect(pdfRules[0].type).toBe('asset/resource')
    const defaultFiles = rules.find(
      (r) =>
        r?.test instanceof RegExp &&
        r.generator?.filename === 'assets/[name].[contenthash:8][ext]' &&
        r.test.test('.csv')
    )
    expect(defaultFiles).toBeTruthy()
    expect(defaultFiles.test.test('.pdf')).toBe(false)
  })

  it('gives fonts the same explicit inline threshold the reporter prints', async () => {
    const compiler = createCompiler()
    await new StaticAssetsPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    }).apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const fonts = rules.find(
      (r) => r?.test instanceof RegExp && r.test.test('.woff2')
    )
    expect(fonts.parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)
  })

  it('respects a type-only custom SVG rule, matching the fonts detector', async () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.svg$/i,
      type: 'asset/inline'
    })

    const plugin = new StaticAssetsPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })
    await plugin.apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const svgRules = rules.filter(
      (r) => r?.test instanceof RegExp && String(r.test) === String(/\.svg$/i)
    )
    expect(svgRules.length).toBe(1)
    expect(svgRules[0].type).toBe('asset/inline')
  })

  it('keeps the default SVG rule when the custom rule is resourceQuery-scoped (SVGR split)', async () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.svg$/i,
      resourceQuery: /react/,
      use: ['@svgr/webpack']
    })

    const plugin = new StaticAssetsPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })
    await plugin.apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const svgRules = rules.filter(
      (r) => r?.test instanceof RegExp && String(r.test) === String(/\.svg$/i)
    )
    // The scoped SVGR rule only claims ?react imports, so plain imports still
    // need the default rule.
    expect(svgRules.length).toBe(2)

    const defaultRule = svgRules.find((r) => r.type === 'asset')
    expect(defaultRule).toBeTruthy()
    // The default excludes the SVGR query so it cannot clobber ?react imports.
    expect(defaultRule.resourceQuery?.not).toEqual([/react/])
  })

  it('keeps the default fonts rule when the custom rule is resourceQuery-scoped', async () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.(woff|woff2|eot|ttf|otf)$/i,
      resourceQuery: /inline/,
      type: 'asset/inline'
    })

    const plugin = new StaticAssetsPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })
    await plugin.apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const fontRules = rules.filter(
      (r) =>
        r?.test instanceof RegExp &&
        String(r.test) === String(/\.(woff|woff2|eot|ttf|otf)$/i)
    )
    expect(fontRules.length).toBe(2)

    const defaultRule = fontRules.find((r) => r.type === 'asset')
    expect(defaultRule).toBeTruthy()
    expect(defaultRule.resourceQuery?.not).toEqual([/inline/])
  })
})
