import * as path from 'path'
import {
  type RspackPluginInstance,
  type Compiler,
  type RuleSetRule
} from '@rspack/core'
import {DevOptions} from '../../develop-lib/config-types'
import {PluginInterface} from '../webpack-types'
import {maybeUseSass} from './css-tools/sass'
import {maybeUseLess} from './css-tools/less'
import {maybeUseStylelint} from './css-tools/stylelint'
import {cssInContentScriptLoader} from './css-in-content-script-loader'
import {cssInHtmlLoader} from './css-in-html-loader'
import {isContentScriptEntry} from './is-content-script'

export class CssPlugin {
  public static readonly name: string = 'plugin-css'

  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private async configureOptions(compiler: Compiler) {
    const mode: DevOptions['mode'] =
      (compiler.options.mode as DevOptions['mode']) || 'development'
    const projectPath = path.dirname(this.manifestPath)

    const plugins: RspackPluginInstance[] = []
    const maybeInstallStylelint = await maybeUseStylelint(projectPath)
    plugins.push(...maybeInstallStylelint)

    // We have two main loaders:
    // 1. cssInContentScriptLoader - for CSS in content scripts
    // 2. cssInHtmlLoader - for CSS in HTML
    // The reason is that for content scripts we need to use the asset loader
    // because it's a content script and we need to load it as an asset.
    // For HTML we need to use the css loader because it's a HTML file
    // and we need to load it as a CSS file.
    const loaders: RuleSetRule[] = [
      ...(await cssInContentScriptLoader(projectPath, mode)),
      ...(await cssInHtmlLoader(projectPath, mode))
    ]

    // Add Sass/Less support if needed
    const maybeInstallSass = await maybeUseSass(projectPath)
    const maybeInstallLess = await maybeUseLess(projectPath)

    // Add SASS/LESS loaders for content scripts
    if (maybeInstallSass.length) {
      loaders.push(
        // SASS files for content scripts
        {
          test: /\.(sass|scss)$/,
          exclude: /\.module\.(sass|scss)$/,
          type: 'asset/resource',
          issuer: (issuer: string) =>
            isContentScriptEntry(issuer, projectPath + '/manifest.json')
        }
      )
    }

    if (maybeInstallLess.length) {
      loaders.push(
        // LESS files for content scripts
        {
          test: /\.less$/,
          exclude: /\.module\.less$/,
          type: 'asset/resource',
          issuer: (issuer: string) =>
            isContentScriptEntry(issuer, projectPath + '/manifest.json')
        }
      )
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
