// ███████╗████████╗ █████╗ ████████╗██╗ ██████╗  █████╗ ███████╗███████╗███████╗████████╗███████╗
// ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔════╝ ██╔══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔════╝
// ███████╗   ██║   ███████║   ██║   ██║██║█████╗███████║███████╗███████╗█████╗     ██║   ███████╗
// ╚════██║   ██║   ██╔══██║   ██║   ██║██║╚════╝██╔══██║╚════██║╚════██║██╔══╝     ██║   ╚════██║
// ███████║   ██║   ██║  ██║   ██║   ██║╚██████╗ ██║  ██║███████║███████║███████╗   ██║   ███████║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler, RuleSetRule} from '@rspack/core'
import {debugLine, isDebug} from '../lib/messaging'
import {RAW_RESOURCE_QUERY} from '../lib/resource-query'
import type {DevOptions, PluginInterface} from '../types'
import {CheckNamespaceImports} from './check-namespace-imports'
import {ASSET_FILENAME_PATTERN} from './static-assets-lib/asset-output-name'
import * as messages from './static-assets-lib/messages'

export class StaticAssetsPlugin {
  public static readonly name: string = 'plugin-static-assets'

  // biome-ignore lint/complexity/noUselessConstructor: rspack-config.ts passes the shared options, nothing here reads them
  constructor(_options?: PluginInterface & {mode?: DevOptions['mode']}) {}

  public apply(compiler: Compiler) {
    new CheckNamespaceImports().apply(compiler)

    compiler.options.module = compiler.options.module || {rules: []}
    compiler.options.module.rules = compiler.options.module.rules || []

    const filenamePattern = ASSET_FILENAME_PATTERN

    // A file no rule below claims (a stylesheet's .cur or .mp4) is still an
    // asset module, which rspack would drop at the root as a bare hash.
    compiler.options.output = compiler.options.output || {}

    if (!compiler.options.output.assetModuleFilename) {
      compiler.options.output.assetModuleFilename = filenamePattern
    }

    // An extensionless import reaches a .wasm file. A config with no list is
    // left alone: a list set here would replace rspack's per-type defaults.
    const extensions = compiler.options.resolve?.extensions

    if (extensions && !extensions.includes('.wasm')) {
      compiler.options.resolve.extensions = [...extensions, '.wasm']
    }

    type InspectableRule = {
      test?: unknown
      use?: unknown
      loader?: unknown
      type?: unknown
      resourceQuery?: unknown
      include?: unknown
      exclude?: unknown
      resource?: unknown
      issuer?: unknown
      issuerLayer?: unknown
    } | null

    const SCOPE_KEYS = [
      'include',
      'exclude',
      'resource',
      'issuer',
      'issuerLayer'
    ] as const

    const hasEffect = (rule: InspectableRule) =>
      Boolean(
        rule &&
          (rule.type !== undefined ||
            rule.use !== undefined ||
            rule.loader !== undefined)
      )

    const hasScope = (rule: InspectableRule) =>
      Boolean(rule && SCOPE_KEYS.some((key) => rule[key] !== undefined))

    // A resourceQuery-scoped rule (SVGR's ?react split) only claims that query
    // slice, so it must not suppress the default rule for plain imports.
    const isFullCustomRuleFor = (thisRule: unknown, sample: string) => {
      const rule = thisRule as InspectableRule

      return Boolean(
        rule &&
          rule.test instanceof RegExp &&
          rule.test.test(sample) &&
          hasEffect(rule) &&
          rule.resourceQuery === undefined &&
          !hasScope(rule)
      )
    }

    // A path- or issuer-scoped rule (a string test is a path prefix) claims part
    // of an extension: the default steps aside inside that scope only.
    const isPartialRuleFor = (thisRule: unknown, sample: string) => {
      const rule = thisRule as InspectableRule

      if (!rule || !hasEffect(rule) || isFullCustomRuleFor(rule, sample)) {
        return false
      }

      if (rule.test instanceof RegExp) {
        return rule.test.test(sample) && hasScope(rule)
      }

      const assetTyped =
        typeof rule.type === 'string' && rule.type.startsWith('asset')

      return assetTyped && (rule.test !== undefined || hasScope(rule))
    }

    const scopeConditionsOf = (rule: InspectableRule): RuleSetRule => {
      const conditions: Record<string, unknown> = {}

      for (const key of ['test', 'resourceQuery', ...SCOPE_KEYS] as const) {
        if (rule?.[key] !== undefined) conditions[key] = rule[key]
      }

      return conditions as RuleSetRule
    }

    const partialRulesFor = (extensions: string[]): InspectableRule[] => {
      const partials = new Set<InspectableRule>()

      for (const thisRule of compiler.options.module.rules) {
        if (extensions.some((ext) => isPartialRuleFor(thisRule, `.${ext}`))) {
          partials.add(thisRule as InspectableRule)
        }
      }

      return Array.from(partials)
    }

    // Query slices claimed by scoped custom rules: the default rule excludes
    // them so a later default cannot clobber the scoped rule's module type.
    const scopedQueriesFor = (sample: string): RegExp[] =>
      compiler.options.module.rules
        .map((thisRule) => thisRule as InspectableRule)
        .filter((rule) =>
          Boolean(
            rule &&
              rule.test instanceof RegExp &&
              rule.test.test(sample) &&
              hasEffect(rule) &&
              rule.resourceQuery instanceof RegExp &&
              !hasScope(rule)
          )
        )
        .map((rule) => rule?.resourceQuery as RegExp)

    const IMAGE_EXTENSIONS = [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'avif',
      'ico',
      'bmp'
    ]
    const FONT_EXTENSIONS = ['woff', 'woff2', 'eot', 'ttf', 'otf']
    const FILE_EXTENSIONS = [
      'txt',
      'md',
      'csv',
      'tsv',
      'xml',
      'pdf',
      'docx',
      'doc',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'zip',
      'gz',
      'gzip',
      'tgz'
    ]

    // A user rule for one extension must win for that extension only: the
    // default rule keeps claiming the siblings (a .png rule leaves .jpg to us)
    // and steps aside for the extensions the user handles, so last-wins on
    // module type never clobbers extension.config.js.
    const unclaimedExtensions = (extensions: string[]) =>
      extensions.filter(
        (ext) =>
          !compiler.options.module.rules.some((thisRule) =>
            isFullCustomRuleFor(thisRule, `.${ext}`)
          )
      )

    const scopedQueriesForAll = (extensions: string[]): RegExp[] => {
      const seen = new Set<RegExp>()

      for (const ext of extensions) {
        for (const query of scopedQueriesFor(`.${ext}`)) seen.add(query)
      }

      return Array.from(seen)
    }

    const inlineKB = 2

    const GROUPS: Array<[label: string, extensions: string[]]> = [
      ['SVG', ['svg']],
      ['Images', IMAGE_EXTENSIONS],
      ['Fonts', FONT_EXTENSIONS],
      ['Files', FILE_EXTENSIONS]
    ]

    type DefaultSlice = {
      extensions: string[]
      queries: RegExp[]
      partials: InspectableRule[]
    }

    // Groups the user rules treat alike share one default rule. A group a
    // scoped user rule sets apart keeps its own, with that rule's carve-outs.
    const slices = new Map<string, DefaultSlice>()
    const customGroups = new Set<string>()
    const userRules = compiler.options.module.rules as unknown[]

    for (const [label, extensions] of GROUPS) {
      const remaining = unclaimedExtensions(extensions)

      if (!remaining.length) {
        customGroups.add(label)
        continue
      }

      const queries = scopedQueriesForAll(remaining)
      const partials = partialRulesFor(remaining)
      const key = JSON.stringify([
        queries.map(String).sort(),
        partials.map((rule) => userRules.indexOf(rule))
      ])
      const slice = slices.get(key)

      if (slice) slice.extensions.push(...remaining)
      else slices.set(key, {extensions: remaining, queries, partials})
    }

    // The rule sets the 2 KB threshold itself: without a parser block it
    // would fall back to rspack's default of 8096 bytes.
    const defaultRules = Array.from(slices.values()).map(
      ({extensions, queries, partials}): RuleSetRule => {
        const test = new RegExp(`\\.(${extensions.join('|')})$`, 'i')
        const resourceQuery = queries.length ? {not: queries} : undefined
        const effects: RuleSetRule = {
          type: 'asset',
          generator: {filename: filenamePattern},
          parser: {dataUrlCondition: {maxSize: inlineKB * 1024}}
        }

        return {
          test,
          ...(resourceQuery ? {resourceQuery} : {}),
          ...(partials.length
            ? {oneOf: [...partials.map(scopeConditionsOf), effects]}
            : effects)
        }
      }
    )

    const hasCustomSvgRule = customGroups.has('SVG')

    const hasResourceQueryRule = (query: string) =>
      compiler.options.module.rules.some((thisRule) => {
        const rule = thisRule as {resourceQuery?: unknown} | null
        const resourceQuery = rule?.resourceQuery
        if (!(resourceQuery instanceof RegExp)) return false

        return resourceQuery.test(query)
      })
    const hasUrlResourceQueryRule = hasResourceQueryRule('?url')
    const hasRawResourceQueryRule = hasResourceQueryRule('?raw')

    const loaders: RuleSetRule[] = [
      ...defaultRules,
      // Last on purpose: rspack resolves overlapping rules last-wins, so the
      // ?url contract (always a file URL) must outrank the inlining rules.
      ...(hasUrlResourceQueryRule
        ? []
        : [
            {
              // Match only the standalone ?url import query: an unanchored /url/ also hit
              // "url" inside classic-concat payloads and hijacked whole entries.
              resourceQuery: /(?:^\?|&)url(?:&|=|$)/,
              type: 'asset/resource',
              generator: {
                filename: filenamePattern
              }
            }
          ]),
      // Vite's ?raw: the file's text as the default export, whatever the
      // extension. The compiling rules exclude this query so no loader
      // rewrites the text before it lands here.
      ...(hasRawResourceQueryRule
        ? []
        : [
            {
              resourceQuery: RAW_RESOURCE_QUERY,
              type: 'asset/source'
            }
          ])
    ]

    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ].filter((rule): rule is RuleSetRule => Boolean(rule))

    if (isDebug()) {
      const rulesEnabled = GROUPS.map(([label]) =>
        customGroups.has(label)
          ? `${label}(custom)`
          : label === 'SVG'
            ? 'SVG(default)'
            : label
      )

      debugLine(messages.assetsRulesEnabled(rulesEnabled))

      debugLine(
        messages.assetsConfigsDetected(
          filenamePattern,
          hasCustomSvgRule ? 'custom' : 'default',
          hasCustomSvgRule ? undefined : inlineKB,
          inlineKB,
          inlineKB
        )
      )

      compiler.hooks.afterEmit.tap(StaticAssetsPlugin.name, (compilation) => {
        try {
          const assets = (compilation?.getAssets?.() || []) as ReadonlyArray<{
            name: string
          }>
          const emitted = assets.filter((a) => a.name?.startsWith('assets/'))
          const counts = {svg: 0, images: 0, fonts: 0, files: 0}

          for (const a of emitted) {
            const n = a.name.toLowerCase()
            if (n.endsWith('.svg')) counts.svg++
            else if (/\.(png|jpg|jpeg|gif|webp|avif|ico|bmp)$/i.test(n)) {
              counts.images++
            } else if (/\.(woff|woff2|eot|ttf|otf)$/i.test(n)) counts.fonts++
            else counts.files++
          }

          debugLine(messages.assetsEmittedSummary(emitted.length, counts))
        } catch {
          // Ignore
        }
      })
    }
  }
}
