// ███████╗████████╗ █████╗ ████████╗██╗ ██████╗  █████╗ ███████╗███████╗███████╗████████╗███████╗
// ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔════╝ ██╔══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔════╝
// ███████╗   ██║   ███████║   ██║   ██║██║█████╗███████║███████╗███████╗█████╗     ██║   ███████╗
// ╚════██║   ██║   ██╔══██║   ██║   ██║██║╚════╝██╔══██║╚════██║╚════██║██╔══╝     ██║   ╚════██║
// ███████║   ██║   ██║  ██║   ██║   ██║╚██████╗ ██║  ██║███████║███████║███████╗   ██║   ███████║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler, RuleSetRule} from '@rspack/core'
import {isDebug} from '../lib/messaging'
import type {DevOptions, PluginInterface} from '../types'
import * as messages from './static-assets-lib/messages'

export class StaticAssetsPlugin {
  public static readonly name: string = 'plugin-static-assets'
  public readonly mode: DevOptions['mode']

  constructor(options: PluginInterface & {mode: DevOptions['mode']}) {
    this.mode = options.mode
  }

  public apply(compiler: Compiler) {
    compiler.options.module = compiler.options.module || {rules: []}
    compiler.options.module.rules = compiler.options.module.rules || []

    // Content-hash in DEV too: same-basename assets in different folders collided
    // on one output name; hashing, not [path], which can escape the output dir.
    const filenamePattern = 'assets/[name].[contenthash:8][ext]'
    const defaultSvgRule: RuleSetRule = {
      test: /\.svg$/i,
      type: 'asset',
      generator: {
        filename: filenamePattern
      },
      parser: {
        dataUrlCondition: {
          maxSize: 2 * 1024
        }
      }
    }

    type InspectableRule = {
      test?: unknown
      use?: unknown
      type?: unknown
      resourceQuery?: unknown
    } | null

    // A resourceQuery-scoped rule (SVGR's ?react split) only claims that query
    // slice, so it must not suppress the default rule for plain imports.
    const isFullCustomRuleFor = (thisRule: unknown, sample: string) => {
      const rule = thisRule as InspectableRule
      return Boolean(
        rule &&
          rule.test instanceof RegExp &&
          rule.test.test(sample) &&
          (rule.type !== undefined || rule.use !== undefined) &&
          rule.resourceQuery === undefined
      )
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
              (rule.type !== undefined || rule.use !== undefined) &&
              rule.resourceQuery instanceof RegExp
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
    const defaultRuleFor = (
      extensions: string[],
      inline: boolean
    ): RuleSetRule | null => {
      const remaining = unclaimedExtensions(extensions)
      if (!remaining.length) return null
      const scoped = scopedQueriesForAll(remaining)
      return {
        test: new RegExp(`\\.(${remaining.join('|')})$`, 'i'),
        type: 'asset',
        generator: {
          filename: filenamePattern
        },
        ...(inline
          ? {parser: {dataUrlCondition: {maxSize: inlineKB * 1024}}}
          : {}),
        ...(scoped.length ? {resourceQuery: {not: scoped}} : {})
      }
    }

    const hasCustomSvgRule = unclaimedExtensions(['svg']).length === 0
    const imagesRule = defaultRuleFor(IMAGE_EXTENSIONS, true)
    // Fonts inline under the same explicit threshold the debug reporter
    // prints; without a parser block rspack's own 8 KB default silently applied.
    const fontsRule = defaultRuleFor(FONT_EXTENSIONS, true)
    const filesRule = defaultRuleFor(FILE_EXTENSIONS, true)

    const hasUrlResourceQueryRule = compiler.options.module.rules.some(
      (thisRule) => {
        const rule = thisRule as {resourceQuery?: unknown} | null
        const resourceQuery = rule?.resourceQuery
        if (!(resourceQuery instanceof RegExp)) return false
        return resourceQuery.test('?url')
      }
    )

    const svgScopedQueries = scopedQueriesFor('.svg')

    const loaders: RuleSetRule[] = [
      ...(hasCustomSvgRule
        ? []
        : [
            svgScopedQueries.length
              ? {...defaultSvgRule, resourceQuery: {not: svgScopedQueries}}
              : defaultSvgRule
          ]),
      ...(imagesRule ? [imagesRule] : []),
      ...(fontsRule ? [fontsRule] : []),
      ...(filesRule ? [filesRule] : []),
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
          ])
    ]

    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ].filter((rule): rule is RuleSetRule => Boolean(rule))

    if (isDebug()) {
      const rulesEnabled: string[] = []
      rulesEnabled.push(hasCustomSvgRule ? 'SVG(custom)' : 'SVG(default)')
      rulesEnabled.push(imagesRule ? 'Images' : 'Images(custom)')
      rulesEnabled.push(fontsRule ? 'Fonts' : 'Fonts(custom)')
      rulesEnabled.push(filesRule ? 'Files' : 'Files(custom)')

      console.log(messages.assetsRulesEnabled(rulesEnabled))

      console.log(
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
            else if (/\.(png|jpg|jpeg|gif|webp|avif|ico|bmp)$/i.test(n))
              counts.images++
            else if (/\.(woff|woff2|eot|ttf|otf)$/i.test(n)) counts.fonts++
            else counts.files++
          }
          console.log(messages.assetsEmittedSummary(emitted.length, counts))
        } catch {
          // Ignore
        }
      })
    }
  }
}
