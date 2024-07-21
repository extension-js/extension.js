import path from 'path'
import {type PathData, type Compiler, type RuleSetRule} from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import {commonStyleLoaders} from './common-style-loaders'
import {DevOptions, PluginInterface} from '../../types'

export class CssPlugin {
  public readonly manifestPath: string
  public readonly mode: DevOptions['mode']

  constructor(options: PluginInterface & {mode: DevOptions['mode']}) {
    this.manifestPath = options.manifestPath
    this.mode = options.mode
  }

  public apply(compiler: Compiler) {
    const projectPath = path.dirname(this.manifestPath)

    new MiniCssExtractPlugin({
      chunkFilename: (pathData: PathData) => {
        const runtime = (pathData.chunk as any)?.runtime
        return `${runtime}/[name].css`
      }
    }).apply(compiler)

    const loaders: RuleSetRule[] = [
      {
        test: /\.css$/,
        exclude: /\.module\.css$/,
        type: 'javascript/auto',
        // https://stackoverflow.com/a/60482491/4902448
        oneOf: [
          {
            resourceQuery: /is_content_css_import=true/,
            use: commonStyleLoaders(projectPath, {
              regex: /\.css$/,
              mode: this.mode,
              useMiniCssExtractPlugin: false
            })
          },
          {
            use: commonStyleLoaders(projectPath, {
              regex: /\.css$/,
              mode: this.mode,
              useMiniCssExtractPlugin: this.mode === 'production'
            })
          }
        ]
      },
      {
        test: /\.module\.css$/,
        type: 'javascript/auto',
        // https://stackoverflow.com/a/60482491/4902448
        oneOf: [
          {
            resourceQuery: /is_content_css_import=true/,
            use: commonStyleLoaders(projectPath, {
              regex: /\.module\.css$/,
              mode: this.mode,
              useMiniCssExtractPlugin: false
            })
          },
          {
            use: commonStyleLoaders(projectPath, {
              regex: /\.module\.css$/,
              mode: this.mode,
              useMiniCssExtractPlugin: this.mode === 'production'
            })
          }
        ]
      }
    ]

    // if (isUsingLess) {
    //   loaders.push(...maybeUseLess(projectPath, opts));
    // }

    // if (isUsingSass) {
    //   loaders.push(...maybeUseSass(projectPath, opts));
    // }

    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ]
  }
}
