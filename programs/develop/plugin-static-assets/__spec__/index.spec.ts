import type {Compiler} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {StaticAssetsPlugin} from '../index'

// The fields of a rule these specs read, on the plugin's rules and the
// project's own.
interface AssetRule {
  test: RegExp
  type?: string
  use?: unknown
  resourceQuery?: {not?: unknown}
  oneOf?: unknown
  parser?: {dataUrlCondition?: {maxSize?: number}}
  generator?: {filename?: string}
}

const rulesOf = (compiler: Compiler) =>
  compiler.options.module.rules as unknown as AssetRule[]

function createCompiler() {
  return {
    options: {
      module: {rules: [] as AssetRule[]},
      resolve: {alias: {} as Record<string, string>}
    },
    hooks: {
      afterEmit: {tap() {}},
      compilation: {tap() {}},
      done: {tap() {}}
    }
  } as unknown as Compiler
}

// The default rules are the ones typed `asset` that carry the output name.
function defaultRulesOf(rules: AssetRule[]) {
  return rules.filter(
    (r) =>
      r?.type === 'asset' &&
      r.generator?.filename === 'assets/[name].[contenthash:8][ext]'
  )
}

// A rule the row expects to find: a missing one fails at the read.
function defaultRuleFor(rules: AssetRule[], sample: string) {
  return defaultRulesOf(rules).find((r) => r.test.test(sample)) as AssetRule
}

describe('StaticAssetsPlugin', () => {
  it('claims every default extension with one rule that inlines up to 2 KB', () => {
    const compiler = createCompiler()
    new StaticAssetsPlugin().apply(compiler)

    const defaults = defaultRulesOf(rulesOf(compiler))

    expect(defaults).toHaveLength(1)
    expect(String(defaults[0].test)).toBe(
      String(
        /\.(svg|png|jpg|jpeg|gif|webp|avif|ico|bmp|woff|woff2|eot|ttf|otf|txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i
      )
    )

    expect(defaults[0].parser?.dataUrlCondition?.maxSize).toBe(2 * 1024)
    expect(defaults[0].resourceQuery).toBeUndefined()
    expect(defaults[0].oneOf).toBeUndefined()
  })

  it('respects existing custom SVG rule (does not add default svg asset rule)', () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.svg$/i,
      use: [{loader: 'custom-svg-loader'}]
    })

    new StaticAssetsPlugin().apply(compiler)

    const rules = rulesOf(compiler)
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

    const rules = rulesOf(compiler)
    const fontRules = rules.filter(
      (r) =>
        r?.test instanceof RegExp &&
        String(r.test) === String(/\.(woff|woff2|eot|ttf|otf)$/i)
    )

    expect(fontRules.length).toBe(1)
    expect(fontRules[0].type).toBe('asset/inline')

    expect(defaultRuleFor(rules, 'font.woff2')).toBeUndefined()
    expect(defaultRuleFor(rules, 'image.png')).toBeTruthy()
    expect(defaultRuleFor(rules, 'doc.pdf')).toBe(
      defaultRuleFor(rules, 'image.png')
    )
  })

  it('lets a user image rule win for its extension and keeps the default for the siblings', () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.png$/i,
      type: 'asset/resource'
    })

    new StaticAssetsPlugin().apply(compiler)

    const rules = rulesOf(compiler)
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

    const rules = rulesOf(compiler)
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
    ) as AssetRule
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

    const rules = rulesOf(compiler)
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

    const rules = rulesOf(compiler)
    const defaultSvg = defaultRuleFor(rules, 'icon.svg')

    // The scoped SVGR rule only claims ?react imports, so plain imports still
    // need the default, which excludes that query for SVG and nothing else.
    expect(String(defaultSvg.test)).toBe(String(/\.(svg)$/i))
    expect(defaultSvg.resourceQuery?.not).toEqual([/react/])
    expect(defaultRulesOf(rules)).toHaveLength(2)
    expect(defaultRuleFor(rules, 'image.png').resourceQuery).toBeUndefined()
    expect(defaultRuleFor(rules, 'font.woff2')).toBe(
      defaultRuleFor(rules, 'image.png')
    )
  })

  it('keeps the default fonts rule when the custom rule is resourceQuery-scoped', () => {
    const compiler = createCompiler()
    compiler.options.module.rules.push({
      test: /\.(woff|woff2|eot|ttf|otf)$/i,
      resourceQuery: /inline/,
      type: 'asset/inline'
    })

    new StaticAssetsPlugin().apply(compiler)

    const rules = rulesOf(compiler)
    const fontRules = rules.filter(
      (r) =>
        r?.test instanceof RegExp &&
        String(r.test) === String(/\.(woff|woff2|eot|ttf|otf)$/i)
    )
    expect(fontRules.length).toBe(2)

    const defaultRule = fontRules.find((r) => r.type === 'asset') as AssetRule
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

  it('appends .wasm to the extensions the config lists, once, and sets no list of its own', () => {
    const withUser = createCompiler()
    const withWasm = createCompiler()
    const withNone = createCompiler()
    withUser.options.resolve.extensions = ['.ts', '.js']
    withWasm.options.resolve.extensions = ['.wasm', '.ts']

    new StaticAssetsPlugin().apply(withUser)
    new StaticAssetsPlugin().apply(withWasm)
    new StaticAssetsPlugin().apply(withNone)

    expect(withUser.options.resolve.extensions).toEqual(['.ts', '.js', '.wasm'])
    expect(withWasm.options.resolve.extensions).toEqual(['.wasm', '.ts'])
    expect(withNone.options.resolve.extensions).toBeUndefined()
    expect(withUser.options.resolve.alias).toEqual({})
  })
})
