import {describe, expect, it} from 'vitest'
import {StaticAssetsPlugin} from '../index'

function createCompiler() {
  return {
    options: {
      module: {rules: [] as any[]},
      resolve: {alias: {} as Record<string, string>}
    },
    hooks: {afterEmit: {tap() {}}, compilation: {tap() {}}}
  } as any
}

function findRuleByTest(rules: any[], regex: RegExp) {
  return rules.find(
    (r) => r?.test instanceof RegExp && String(r.test) === String(regex)
  )
}

describe('StaticAssetsPlugin', () => {
  it('gives every default rule a content-hashed name and the 2 KB inline threshold', () => {
    const compiler = createCompiler()
    new StaticAssetsPlugin().apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const defaults = [
      /\.svg$/i,
      /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp)$/i,
      /\.(woff|woff2|eot|ttf|otf)$/i,
      /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i
    ].map((test) => findRuleByTest(rules, test))

    for (const rule of defaults) {
      expect(rule.type).toBe('asset')
      expect(rule.generator?.filename).toBe(
        'assets/[name].[contenthash:8][ext]'
      )

      expect(rule.parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)
    }
  })

  it('respects existing custom SVG rule (does not add default svg asset rule)', () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.svg$/i,
      use: [{loader: 'custom-svg-loader'}]
    })

    new StaticAssetsPlugin().apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const svgRules = rules.filter(
      (r) => r?.test instanceof RegExp && String(r.test) === String(/\.svg$/i)
    )
    expect(svgRules.length).toBe(1)
    expect(svgRules[0].use).toBeDefined()
    expect(svgRules[0].type).toBeUndefined()
  })

  it('respects existing custom fonts rule (does not add default fonts asset rule)', () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.(woff|woff2|eot|ttf|otf)$/i,
      type: 'asset/inline'
    })

    new StaticAssetsPlugin().apply(compiler)

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

  it('lets a user image rule win for its extension and keeps the default for the siblings', () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.png$/i,
      type: 'asset/resource'
    })

    new StaticAssetsPlugin().apply(compiler)

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

  it('lets a user documents rule win for its extension too', () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.pdf$/i,
      type: 'asset/resource'
    })

    new StaticAssetsPlugin().apply(compiler)

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

  it('respects a type-only custom SVG rule, matching the fonts detector', () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.svg$/i,
      type: 'asset/inline'
    })

    new StaticAssetsPlugin().apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const svgRules = rules.filter(
      (r) => r?.test instanceof RegExp && String(r.test) === String(/\.svg$/i)
    )
    expect(svgRules.length).toBe(1)
    expect(svgRules[0].type).toBe('asset/inline')
  })

  it('keeps the default SVG rule when the custom rule is resourceQuery-scoped (SVGR split)', () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.svg$/i,
      resourceQuery: /react/,
      use: ['@svgr/webpack']
    })

    new StaticAssetsPlugin().apply(compiler)

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

  it('keeps the default fonts rule when the custom rule is resourceQuery-scoped', () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.(woff|woff2|eot|ttf|otf)$/i,
      resourceQuery: /inline/,
      type: 'asset/inline'
    })

    new StaticAssetsPlugin().apply(compiler)

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

  it('names an asset no rule claims under assets/ like every other asset', () => {
    const compiler = createCompiler()

    new StaticAssetsPlugin().apply(compiler)

    expect(compiler.options.output.assetModuleFilename).toBe(
      'assets/[name].[contenthash:8][ext]'
    )
  })

  it('keeps an assetModuleFilename the user configured', () => {
    const compiler = createCompiler()
    compiler.options.output = {assetModuleFilename: 'media/[name][ext]'}

    new StaticAssetsPlugin().apply(compiler)

    expect(compiler.options.output.assetModuleFilename).toBe(
      'media/[name][ext]'
    )
  })
})
