// ███████╗████████╗ █████╗ ████████╗██╗ ██████╗  █████╗ ███████╗███████╗███████╗████████╗███████╗
// ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔════╝ ██╔══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔════╝
// ███████╗   ██║   ███████║   ██║   ██║██║█████╗███████║███████╗███████╗█████╗     ██║   ███████╗
// ╚════██║   ██║   ██╔══██║   ██║   ██║██║╚════╝██╔══██║╚════██║╚════██║██╔══╝     ██║   ╚════██║
// ███████║   ██║   ██║  ██║   ██║   ██║╚██████╗ ██║  ██║███████║███████║███████╗   ██║   ███████║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
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
      oneOf?: unknown
      rules?: unknown
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

    const CONDITION_KEYS = ['test', 'resourceQuery', ...SCOPE_KEYS] as const

    // The user rules as rspack applies them: a rule nested in oneOf or rules
    // also carries its parents' conditions. Top-level rules keep their identity.
    const flattenRules = (
      rules: unknown,
      inherited: InspectableRule | undefined,
      out: InspectableRule[]
    ) => {
      if (!Array.isArray(rules)) return out

      for (const thisRule of rules) {
        if (!thisRule || typeof thisRule !== 'object') continue

        const rule = thisRule as NonNullable<InspectableRule>
        let effective: NonNullable<InspectableRule> = rule

        if (inherited) {
          effective = {...rule}

          for (const key of CONDITION_KEYS) {
            const parent = inherited[key]
            const own = rule[key]
            if (parent === undefined) continue

            // Two excludes skip either match, every other pair must both match.
            effective[key] =
              own === undefined
                ? parent
                : key === 'exclude'
                  ? [parent, own].flat()
                  : {and: [parent, own]}
          }
        }

        out.push(effective)
        flattenRules(effective.oneOf, effective, out)
        flattenRules(effective.rules, effective, out)
      }

      return out
    }

    const userRules = flattenRules(compiler.options.module.rules, undefined, [])

    const sampleFor = (ext: string) =>
      path.join(compiler.context || process.cwd(), `file.${ext}`)

    // true when the test certainly matches a file of this extension, false when
    // it certainly does not, undefined when it depends on the path (a string).
    const testMatches = (test: unknown, ext: string): boolean | undefined => {
      if (test instanceof RegExp) return test.test(`.${ext}`)

      if (typeof test === 'function') {
        try {
          return Boolean(test(sampleFor(ext)))
        } catch {
          return undefined
        }
      }

      if (Array.isArray(test)) return anyOf(test, ext)

      if (test && typeof test === 'object') {
        const {and, or, not} = test as {
          and?: unknown
          or?: unknown
          not?: unknown
        }
        const parts: Array<boolean | undefined> = []

        if (Array.isArray(and)) parts.push(allOf(and, ext))
        if (Array.isArray(or)) parts.push(anyOf(or, ext))

        if (not !== undefined) {
          const negated = testMatches(not, ext)
          parts.push(negated === undefined ? undefined : !negated)
        }

        return parts.length ? allOfResults(parts) : undefined
      }

      return undefined
    }

    const anyOf = (tests: unknown[], ext: string) => {
      const results = tests.map((test) => testMatches(test, ext))
      if (results.includes(true)) return true

      return results.includes(undefined) ? undefined : false
    }

    const allOfResults = (results: Array<boolean | undefined>) => {
      if (results.includes(false)) return false

      return results.includes(undefined) ? undefined : true
    }

    const allOf = (tests: unknown[], ext: string) =>
      allOfResults(tests.map((test) => testMatches(test, ext)))

    // A RegExp keeps its plain reading. Any other test must also turn away a
    // made-up extension, so a catch-all function never claims every asset.
    const UNCLAIMED_PROBE = 'extensionjs-unclaimed-probe'

    const claimsExtension = (rule: InspectableRule, sample: string) => {
      const test = rule?.test
      const ext = sample.replace(/^\./, '')

      if (test instanceof RegExp) return test.test(sample)
      if (test === undefined) return false

      return (
        testMatches(test, ext) === true &&
        testMatches(test, UNCLAIMED_PROBE) === false
      )
    }

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
          claimsExtension(rule, sample) &&
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

      if (claimsExtension(rule, sample)) return hasScope(rule)

      const assetTyped =
        typeof rule.type === 'string' && rule.type.startsWith('asset')

      return assetTyped && (rule.test !== undefined || hasScope(rule))
    }

    const scopeConditionsOf = (rule: InspectableRule): RuleSetRule => {
      const conditions: Record<string, unknown> = {}

      for (const key of CONDITION_KEYS) {
        if (rule?.[key] !== undefined) conditions[key] = rule[key]
      }

      return conditions as RuleSetRule
    }

    const partialRulesFor = (extensions: string[]): InspectableRule[] => {
      const partials = new Set<InspectableRule>()

      for (const thisRule of userRules) {
        if (extensions.some((ext) => isPartialRuleFor(thisRule, `.${ext}`))) {
          partials.add(thisRule)
        }
      }

      return Array.from(partials)
    }

    // Query slices claimed by scoped custom rules: the default rule excludes
    // them so a later default cannot clobber the scoped rule's module type.
    const scopedQueriesFor = (sample: string): RegExp[] =>
      userRules
        .filter((rule) =>
          Boolean(
            rule &&
              claimsExtension(rule, sample) &&
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
          !userRules.some((thisRule) =>
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

    // A user rule for a query on every file replaces the default query rule.
    // One limited by test or scope is carved out of it instead, so ?url on
    // the other types keeps its default.
    const queryRule = (query: string, rule: RuleSetRule): RuleSetRule[] => {
      const owners = userRules.filter(
        (thisRule) =>
          thisRule?.resourceQuery instanceof RegExp &&
          thisRule.resourceQuery.test(query)
      )

      if (
        owners.some((owner) => owner?.test === undefined && !hasScope(owner))
      ) {
        return []
      }

      if (!owners.length) return [rule]

      const {resourceQuery, ...effects} = rule

      return [
        {resourceQuery, oneOf: [...owners.map(scopeConditionsOf), effects]}
      ]
    }

    const loaders: RuleSetRule[] = [
      ...defaultRules,
      // Last on purpose: rspack resolves overlapping rules last-wins, so the
      // ?url contract (always a file URL) must outrank the inlining rules.
      ...queryRule('?url', {
        // Match only the standalone ?url import query: an unanchored /url/ also hit
        // "url" inside classic-concat payloads and hijacked whole entries.
        resourceQuery: /(?:^\?|&)url(?:&|=|$)/,
        type: 'asset/resource',
        generator: {
          filename: filenamePattern
        }
      }),
      // Vite's ?raw: the file's text as the default export, whatever the
      // extension. The compiling rules exclude this query so no loader
      // rewrites the text before it lands here.
      ...queryRule('?raw', {
        resourceQuery: RAW_RESOURCE_QUERY,
        type: 'asset/source'
      })
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
