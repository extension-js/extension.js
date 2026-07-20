// ███████╗████████╗ █████╗ ████████╗██╗ ██████╗  █████╗ ███████╗███████╗███████╗████████╗███████╗
// ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔════╝ ██╔══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔════╝
// ███████╗   ██║   ███████║   ██║   ██║██║█████╗███████║███████╗███████╗█████╗     ██║   ███████╗
// ╚════██║   ██║   ██╔══██║   ██║   ██║██║╚════╝██╔══██║╚════██║╚════██║██╔══╝     ██║   ╚════██║
// ███████║   ██║   ██║  ██║   ██║   ██║╚██████╗ ██║  ██║███████║███████║███████╗   ██║   ███████║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler, RuleSetRule} from '@rspack/core'
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

    const hasCustomSvgRule = compiler.options.module.rules.some((thisRule) => {
      const rule = thisRule as {test?: unknown; use?: unknown} | null
      return Boolean(
        rule &&
          rule.test instanceof RegExp &&
          rule.test.test('.svg') &&
          rule.use !== undefined
      )
    })

    const hasUrlResourceQueryRule = compiler.options.module.rules.some(
      (thisRule) => {
        const rule = thisRule as {resourceQuery?: unknown} | null
        const resourceQuery = rule?.resourceQuery
        if (!(resourceQuery instanceof RegExp)) return false
        return resourceQuery.test('?url')
      }
    )

    // Skip when an existing rule handles fonts, letting users opt into
    // asset/inline for strict CSP pages.
    const hasCustomFontsRule = compiler.options.module.rules.some(
      (thisRule) => {
        const rule = thisRule as RuleSetRule

        if (!rule || !(rule.test instanceof RegExp)) return false
        if (!rule.test.test('.woff')) return false

        // Consider both `type`-based rules and loader-based rules as custom.
        return rule.type !== undefined || rule.use !== undefined
      }
    )

    const loaders: RuleSetRule[] = [
      ...(hasUrlResourceQueryRule
        ? []
        : [
            {
              // Match only the standalone ?url import query: an unanchored /url/ also hit
              // "url" inside classic-concat payloads and hijacked whole entries.
              resourceQuery: /(?:^\?|&)url(?:&|=|$)/,
              type: 'asset/resource'
            }
          ]),
      ...(hasCustomSvgRule ? [] : [defaultSvgRule]),
      {
        test: /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp)$/i,
        type: 'asset',
        generator: {
          filename: filenamePattern
        },
        parser: {
          dataUrlCondition: {
            maxSize: 2 * 1024
          }
        }
      },
      ...(hasCustomFontsRule
        ? []
        : [
            {
              test: /\.(woff|woff2|eot|ttf|otf)$/i,
              type: 'asset',
              generator: {
                filename: filenamePattern
              }
            }
          ]),
      {
        test: /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i,
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
    ]

    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ].filter((rule): rule is RuleSetRule => Boolean(rule))

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const rulesEnabled: string[] = []
      rulesEnabled.push(hasCustomSvgRule ? 'SVG(custom)' : 'SVG(default)')
      rulesEnabled.push('Images')
      rulesEnabled.push('Fonts')
      rulesEnabled.push('Files')

      console.log(messages.assetsRulesEnabled(rulesEnabled))

      const inlineKB = 2
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
