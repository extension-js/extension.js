import path from 'path'
import {
  type WebpackPluginInstance,
  type PathData,
  type Compiler,
  type RuleSetRule
} from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import {commonStyleLoaders} from './common-style-loaders'
import {PluginInterface} from '../webpack-types'
import {type DevOptions} from '../../commands/dev'
import {maybeUseSass} from './css-tools/sass'
import {maybeUseLess} from './css-tools/less'
import {maybeUseStylelint} from './css-tools/stylelint'
import {getAssetFilename} from '../webpack-config'

export class CssPlugin {
  public static readonly name: string = 'plugin-css'

  public readonly manifestPath: string
  public readonly mode: DevOptions['mode']

  constructor(options: PluginInterface & {mode: DevOptions['mode']}) {
    this.manifestPath = options.manifestPath
    this.mode = options.mode
  }

  public async apply(compiler: Compiler) {
    const projectPath = path.dirname(this.manifestPath)

    const plugins: WebpackPluginInstance[] = [
      new MiniCssExtractPlugin({
        chunkFilename: (pathData: PathData) => {
          const runtime = (pathData.chunk as any)?.runtime

          return getAssetFilename(runtime)
        }
      })
    ]

    const maybeInstallStylelint = await maybeUseStylelint(projectPath)
    plugins.push(...maybeInstallStylelint)

    const loaders: RuleSetRule[] = [
      {
        test: /\.css$/,
        exclude: /\.module\.css$/,
        oneOf: [
          {
            resourceQuery: /is_content_css_import=true/,
            use: await commonStyleLoaders(projectPath, {
              mode: this.mode,
              useMiniCssExtractPlugin: false
            })
          },
          {
            use: await commonStyleLoaders(projectPath, {
              mode: this.mode,
              useMiniCssExtractPlugin: this.mode === 'production'
            })
          }
        ]
      },
      {
        test: /\.module\.css$/,
        oneOf: [
          {
            resourceQuery: /is_content_css_import=true/,
            use: await commonStyleLoaders(projectPath, {
              mode: this.mode,
              useMiniCssExtractPlugin: false
            })
          },
          {
            use: await commonStyleLoaders(projectPath, {
              mode: this.mode,
              useMiniCssExtractPlugin: this.mode === 'production'
            })
          }
        ]
      }
    ]

    compiler.options.plugins = [...compiler.options.plugins, ...plugins].filter(
      Boolean
    )

    const maybeInstallSass = await maybeUseSass(projectPath, this.mode)
    const maybeInstallLess = await maybeUseLess(projectPath, this.mode)
    loaders.push(...maybeInstallSass)
    loaders.push(...maybeInstallLess)

    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ].filter(Boolean)
  }
}
