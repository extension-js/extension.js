import {type Compiler, type RuleSetRule} from '@rspack/core'
import type {PluginInterface, DevOptions} from '../webpack-types'

export class StaticAssetsPlugin {
  public static readonly name: string = 'plugin-static-assets'
  public readonly mode: DevOptions['mode']

  constructor(options: PluginInterface & {mode: DevOptions['mode']}) {
    this.mode = options.mode
  }

  public async apply(compiler: Compiler) {
    // Defensive defaults in case consumers did not initialize module/rules
    compiler.options.module = compiler.options.module || {rules: []}
    compiler.options.module.rules = compiler.options.module.rules || []

    const filenamePattern =
      this.mode === 'production'
        ? 'assets/[name].[contenthash:8][ext]'
        : 'assets/[name][ext]'
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

    const loaders: RuleSetRule[] = [
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
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset',
        generator: {
          filename: filenamePattern
        }
      },
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
  }
}
