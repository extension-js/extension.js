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
    // Defensive defaults in case consumers did not initialize module/rules
    compiler.options.module = compiler.options.module || {rules: []}
    compiler.options.module.rules = compiler.options.module.rules || []

    // Content-hash in DEV too. Dev used to emit `assets/[name][ext]`, so two
    // assets with the same basename in different folders (wild: noscript ships
    // both `img/ui-custom64.webp` and `img/vintage/ui-custom64.webp`) collided
    // on one output name and rspack failed the compilation with "Conflict:
    // Multiple assets emit different content to the same filename", `build`
    // was fine (it hashes) while `extension dev` never booted at all.
    // Hashing, not `[path]`: a path-based name can escape the output dir and
    // clobber sources in the watch loop.
    const filenamePattern = 'assets/[name].[contenthash:8][ext]'
    // Define the default SVG rule
    const defaultSvgRule: RuleSetRule = {
      test: /\.svg$/i,
      type: 'asset',
      generator: {
        filename: filenamePattern
      },
      parser: {
        dataUrlCondition: {
          maxSize: 2 * 1024 // 2kb
        }
      }
    }

    // Check if any existing rule handles SVG files
    const hasCustomSvgRule = compiler.options.module.rules.some((rule) => {
      return (
        (rule as any) &&
        (rule as any).test instanceof RegExp &&
        (rule as any).test.test('.svg') &&
        (rule as any).use !== undefined
      )
    })

    const hasUrlResourceQueryRule = compiler.options.module.rules.some(
      (thisRule) => {
        const rule = thisRule as RuleSetRule
        const resourceQuery = (rule as any)?.resourceQuery
        if (!(resourceQuery instanceof RegExp)) return false
        return resourceQuery.test('?url')
      }
    )

    // Check if any existing rule handles font files.
    // This allows users to opt into `asset/inline` for strict CSP pages
    // (e.g. Firefox content scripts where moz-extension:// font loads can be blocked).
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
              // Match only the standalone `?url` import query (e.g.
              // `import href from './icon.png?url'`). An unanchored /url/ also
              // matched "url" anywhere in a resourceQuery, including inside the
              // __extensionjs_classic_concat__ payload when a concatenated file
              // name contains "url" (e.g. clearurls.js), which wrongly turned the
              // whole content-script/background concat entry into an asset/resource
              // emitted under a hash name instead of its canonical chunk file.
              resourceQuery: /(?:^\?|&)url(?:&|=|$)/,
              type: 'asset/resource'
            }
          ]),
      // Only add the default SVG rule if there's no custom SVG rule
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
      // Only add the default fonts rule if there's no custom fonts rule
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

    // Ensure rules are properly merged and filtered
    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ].filter((rule): rule is RuleSetRule => Boolean(rule))

    // Author mode: summarize assets rules/configs and emitted outputs
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

      compiler.hooks.afterEmit.tap(
        StaticAssetsPlugin.name,
        (compilation: any) => {
          try {
            const assets = (compilation?.getAssets?.() || []) as Array<{
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
            // silent
          }
        }
      )
    }
  }
}
