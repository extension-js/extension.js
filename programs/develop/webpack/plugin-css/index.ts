import path from 'path'
import {
  type WebpackPluginInstance,
  type Compiler,
  type RuleSetRule
} from 'webpack'
import {commonStyleLoaders} from './common-style-loaders'
import {PluginInterface} from '../webpack-types'
import {maybeUseSass} from './css-tools/sass'
import {maybeUseLess} from './css-tools/less'
import {maybeUseStylelint} from './css-tools/stylelint'

export class CssPlugin {
  public static readonly name: string = 'plugin-css'

  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private async configureOptions(compiler: Compiler) {
    const mode = compiler.options.mode || 'development'
    const projectPath = path.dirname(this.manifestPath)
    const plugins: WebpackPluginInstance[] = []

    plugins.forEach((plugin) => plugin.apply(compiler))

    const maybeInstallStylelint = await maybeUseStylelint(projectPath)
    plugins.push(...maybeInstallStylelint)

    const loaders: RuleSetRule[] = [
      {
        test: /\.css$/,
        exclude: /\.module\.css$/,
        oneOf: [
          // Legacy inline style loader. This will
          // be deprecated in v2.0.0
          {
            resourceQuery: /inline_style/,
            use: await commonStyleLoaders(projectPath, {
              mode: mode as 'development' | 'production',
              useMiniCssExtractPlugin: false,
              useShadowDom: true
            })
          },
          {
            use: await commonStyleLoaders(projectPath, {
              mode: mode as 'development' | 'production',
              useMiniCssExtractPlugin: mode === 'production',
              useShadowDom: false
            })
          }
        ]
      },
      {
        test: /\.module\.css$/,
        oneOf: [
          {
            resourceQuery: /inline_style/,
            use: await commonStyleLoaders(projectPath, {
              mode: mode as 'development' | 'production',
              useMiniCssExtractPlugin: false,
              useShadowDom: true
            })
          },
          {
            use: await commonStyleLoaders(projectPath, {
              mode: mode as 'development' | 'production',
              useMiniCssExtractPlugin: mode === 'production',
              useShadowDom: false
            })
          }
        ]
      }
    ]

    compiler.options.plugins = [...compiler.options.plugins, ...plugins].filter(
      Boolean
    )

    const maybeInstallSass = await maybeUseSass(
      projectPath,
      mode as 'development' | 'production'
    )
    const maybeInstallLess = await maybeUseLess(
      projectPath,
      mode as 'development' | 'production'
    )
    loaders.push(...maybeInstallSass)
    loaders.push(...maybeInstallLess)

    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ].filter(Boolean)
  }

  public async apply(compiler: Compiler) {
    const mode = compiler.options.mode || 'development'
    if (mode === 'production') {
      compiler.hooks.beforeRun.tapPromise(
        CssPlugin.name,
        async () => await this.configureOptions(compiler)
      )
      return
    }
    await this.configureOptions(compiler)
  }
}
