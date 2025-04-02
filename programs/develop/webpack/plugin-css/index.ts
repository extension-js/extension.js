import path from 'path'
import {
  type RspackPluginInstance,
  type Compiler,
  type RuleSetRule
} from '@rspack/core'
import {DevOptions} from '../../commands/commands-lib/config-types'
import {PluginInterface} from '../webpack-types'
import {maybeUseSass} from './css-tools/sass'
import {maybeUseLess} from './css-tools/less'
import {maybeUseStylelint} from './css-tools/stylelint'
import {contentScriptCssLoader} from './content-script-css-loader'
import {commonStyleLoaders} from './common-style-loaders'

export class CssPlugin {
  public static readonly name: string = 'plugin-css'

  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private async configureOptions(compiler: Compiler) {
    const mode: DevOptions['mode'] = compiler.options.mode || 'development'
    const projectPath = path.dirname(this.manifestPath)

    const plugins: RspackPluginInstance[] = []
    const maybeInstallStylelint = await maybeUseStylelint(projectPath)
    plugins.push(...maybeInstallStylelint)

    const loaders: RuleSetRule[] = [
      await contentScriptCssLoader(projectPath, mode),
      {
        test: /\.css$/,
        type: 'css',
        // type: 'css' breaks content scripts.
        // TODO: cezaraugusto this is fragile, we need to find a better way
        issuer: (issuer: string) => !issuer.includes('content'),
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
