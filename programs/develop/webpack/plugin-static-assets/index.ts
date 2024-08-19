import {type Compiler, type RuleSetRule} from 'webpack'
import {PluginInterface} from '../webpack-types'
import {type DevOptions} from '../../commands/dev'

export class StaticAssetsPlugin {
  public static readonly name: string = 'plugin-css'

  public readonly manifestPath: string
  public readonly mode: DevOptions['mode']

  constructor(options: PluginInterface & {mode: DevOptions['mode']}) {
    this.manifestPath = options.manifestPath
    this.mode = options.mode
  }

  public async apply(compiler: Compiler) {
    // Define the default SVG rule
    const defaultSvgRule: RuleSetRule = {
      test: /\.svg$/i,
      type: 'asset/resource',
      parser: {
        dataUrlCondition: {
          // inline images < 2 KB
          maxSize: 2 * 1024
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
        type: 'asset/resource',
        parser: {
          dataUrlCondition: {
            // inline images < 2 KB
            maxSize: 2 * 1024
          }
        }
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource'
      },
      {
        test: /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i,
        type: 'asset/resource',
        parser: {
          dataUrlCondition: {
            // inline images < 2 KB
            maxSize: 2 * 1024
          }
        }
      },
      {
        test: /\.(csv|tsv)$/i,
        use: [require.resolve('csv-loader')]
      }
    ]

    // Combine user rules with default rules, ensuring no conflict for SVGs
    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ].filter(Boolean)
  }
}
