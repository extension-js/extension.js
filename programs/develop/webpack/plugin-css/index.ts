import path from 'path'
import rspack, {
  type RspackPluginInstance,
  type Compiler,
  type RuleSetRule
} from '@rspack/core'
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

    const plugins: RspackPluginInstance[] = [
      new rspack.CssExtractRspackPlugin()
    ]

    plugins.forEach((plugin) => plugin.apply(compiler))

    const maybeInstallStylelint = await maybeUseStylelint(projectPath)
    plugins.push(...maybeInstallStylelint)

    const loaders: RuleSetRule[] = [
      {
        test: /\.css$/,
        exclude: /\.module\.css$/,
        oneOf: [
          {
            resourceQuery: /inline_style/,
            type: 'javascript/auto',
            use: await commonStyleLoaders(projectPath, {
              mode: mode as 'development' | 'production',
              useMiniCssExtractPlugin: false,
              useShadowDom: true
            })
          },
          {
            type: 'css/auto'
          }
        ]
      },
      {
        test: /\.module\.css$/,
        type: 'css/auto',
        oneOf: [
          {
            resourceQuery: /inline_style/,
            type: 'javascript/auto',
            use: await commonStyleLoaders(projectPath, {
              mode: mode as 'development' | 'production',
              useMiniCssExtractPlugin: false,
              useShadowDom: true
            })
          },
          {
            type: 'css/auto'
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
