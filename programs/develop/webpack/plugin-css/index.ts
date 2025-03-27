import path from 'path'
import {
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

    const plugins: RspackPluginInstance[] = []
    const maybeInstallStylelint = await maybeUseStylelint(projectPath)
    plugins.push(...maybeInstallStylelint)

    const loaders: RuleSetRule[] = [
      {
        test: /\.css$/,
        type: 'asset',
        issuer: (issuer: string) => issuer.includes('content'),
        generator: {
          filename: (pathData: any) => {
            const index = pathData.info?.index || 0
            // Add contenthash to avoid naming collisions between different content script CSS files
            return `content_scripts/content-${index}.[contenthash:8].css`
          }
        }
      },
      {
        test: /\.css$/,
        type: 'css',
        use: await commonStyleLoaders(projectPath, {
          mode: mode as 'development' | 'production'
        })
      }
    ]

    // Add Sass/Less support if needed
    const maybeInstallSass = await maybeUseSass(projectPath)
    const maybeInstallLess = await maybeUseLess(projectPath)

    if (maybeInstallSass.length) {
      loaders.push(...maybeInstallSass)
    }

    if (maybeInstallLess.length) {
      loaders.push(...maybeInstallLess)
    }

    // Update compiler configuration
    compiler.options.plugins = [...compiler.options.plugins, ...plugins].filter(
      Boolean
    )
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
