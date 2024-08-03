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
    const getAssetFilename = (folderPath: string) => {
      return `${folderPath}/[name][ext]`
    }

    const loaders: RuleSetRule[] = [
      {
        test: /\.svg$/i,
        type: 'asset',
        // *.svg?url
        resourceQuery: /url/,
        generator: {
          filename: () => getAssetFilename('assets')
        }
      },
      {
        test: /\.svg$/i,
        issuer: /\.[jt]sx?$/,
        // exclude react component if *.svg?url
        resourceQuery: {not: [/url/]},
        use: ['@svgr/webpack'],
        generator: {
          filename: () => getAssetFilename('assets')
        }
      },
      {
        test: /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp)$/i,
        type: 'asset/resource',
        generator: {
          filename: () => getAssetFilename('assets')
        },
        parser: {
          dataUrlCondition: {
            // inline images < 2 KB
            maxSize: 2 * 1024
          }
        }
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
        generator: {
          filename: () => getAssetFilename('assets')
        }
      },
      {
        test: /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i,
        type: 'asset/resource',
        generator: {
          filename: () => getAssetFilename('assets')
        },
        parser: {
          dataUrlCondition: {
            // inline images < 2 KB
            maxSize: 2 * 1024
          }
        }
      },
      {
        test: /\.(csv|tsv)$/i,
        use: [require.resolve('csv-loader')],
        generator: {
          filename: () => getAssetFilename('assets')
        }
      }
    ]

    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ].filter(Boolean)
  }
}
