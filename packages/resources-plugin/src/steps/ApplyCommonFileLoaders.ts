import type webpack from 'webpack'
import {type WebResourcesPluginInterface} from '../../types'

export default class ApplyCommonFileLoaders {
  private readonly manifestPath: string

  constructor(options: WebResourcesPluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private loaders() {
    const getFilename = (runtime: string, folderPath: string) => {
      if (runtime.startsWith('content_scripts')) {
        const [, contentName] = runtime.split('/')
        const index = contentName.split('-')[1]

        return `web_accessible_resources/resource-${index}/[name][ext]`
      }

      return `${folderPath}/[name][ext]`
    }

    const assetLoaders = [
      {
        test: /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp|svg)$/i,
        type: 'asset/resource',
        generator: {
          filename: ({runtime}: {runtime: string}) =>
            getFilename(runtime, 'assets')
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
          filename: ({runtime}: {runtime: string}) =>
            getFilename(runtime, 'assets')
        }
      },
      {
        test: /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i,
        type: 'asset/resource',
        generator: {
          filename: ({runtime}: {runtime: string}) =>
            getFilename(runtime, 'assets')
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
        use: ['csv-loader'],
        generator: {
          filename: ({runtime}: {runtime: string}) =>
            getFilename(runtime, 'assets')
        }
      }
    ]

    return assetLoaders
  }

  apply(compiler: webpack.Compiler) {
    const supportedLoaders = this.loaders()
    compiler.options.module?.rules.push(...supportedLoaders)
  }
}
