//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {
  type RspackPluginInstance,
  type Compiler,
  type RuleSetRule
} from '@rspack/core'
import * as messages from './css-lib/messages'
import {hasDependency} from './css-lib/integrations'
import {maybeUseSass} from './css-tools/sass'
import {maybeUseLess} from './css-tools/less'
import {maybeUseStylelint} from './css-tools/stylelint'
import {cssInContentScriptLoader} from './css-in-content-script-loader'
import {cssInHtmlLoader} from './css-in-html-loader'
import {isContentScriptEntry} from './css-lib/is-content-script'
import type {DevOptions, PluginInterface} from '../webpack-types'
import {getStylelintConfigFile} from './css-tools/stylelint'
import {getTailwindConfigFile} from './css-tools/tailwind'

export class CssPlugin {
  public static readonly name: string = 'plugin-css'

  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private async configureOptions(compiler: Compiler) {
    const mode: DevOptions['mode'] =
      (compiler.options.mode as DevOptions['mode']) || 'development'
    const projectPath = (compiler.options.context as string) || process.cwd()

    const plugins: RspackPluginInstance[] = []
    const manifestPath = this.manifestPath
    const usingSass = hasDependency(projectPath, 'sass')
    const usingLess = hasDependency(projectPath, 'less')
    const maybeInstallStylelint = await maybeUseStylelint(projectPath)
    plugins.push(...maybeInstallStylelint)

    // We have two main loaders:
    // 1. cssInContentScriptLoader - for CSS in content scripts
    // 2. cssInHtmlLoader - for CSS in HTML
    // The reason is that for content scripts we need to use the asset loader
    // because it's a content script and we need to load it as an asset.
    // For HTML we need to use the css loader because it's a HTML file
    // and we need to load it as a CSS file.
    // Add Sass/Less support if needed before resolving loaders
    const maybeInstallSass = await maybeUseSass(projectPath)
    const maybeInstallLess = await maybeUseLess(projectPath, manifestPath)

    const loaders: RuleSetRule[] = [
      ...(await cssInContentScriptLoader(projectPath, manifestPath, mode, {
        useSass: usingSass,
        useLess: usingLess
      })),
      ...(await cssInHtmlLoader(projectPath, mode, manifestPath, {
        useSass: usingSass,
        useLess: usingLess
      }))
    ]

    // Add SASS/LESS loaders for content scripts
    if (maybeInstallSass.length) {
      loaders.push(
        // SASS files for content scripts
        {
          test: /\.(sass|scss)$/,
          exclude: /\.module\.(sass|scss)$/,
          type: 'asset/resource',
          generator: {filename: 'content_scripts/[name].[contenthash:8].css'},
          issuer: (issuer: string) => isContentScriptEntry(issuer, manifestPath)
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
          generator: {filename: 'content_scripts/[name].[contenthash:8].css'},
          issuer: (issuer: string) => isContentScriptEntry(issuer, manifestPath)
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

    // Author mode: summarize CSS integrations and configs
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const integrations: string[] = []
      const usingTailwind = hasDependency(projectPath, 'tailwindcss')
      const usingPostcss =
        hasDependency(projectPath, 'postcss') ||
        findPostCssConfig(projectPath) !== undefined ||
        usingSass ||
        usingLess ||
        usingTailwind

      if (usingPostcss) integrations.push('PostCSS')
      if (usingSass) integrations.push('Sass')
      if (usingLess) integrations.push('Less')
      if (usingTailwind) integrations.push('Tailwind')

      console.log(messages.cssIntegrationsEnabled(integrations))

      const postcssConfig = findPostCssConfig(projectPath)
      const stylelintConfig = getStylelintConfigFile(projectPath)
      const tailwindConfig = getTailwindConfigFile(projectPath)
      const browserslistSource = findBrowserslistSource(projectPath)

      console.log(
        messages.cssConfigsDetected(
          postcssConfig,
          stylelintConfig,
          tailwindConfig,
          browserslistSource
        )
      )
    }
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

const postCssConfigFiles = [
  '.postcssrc',
  '.postcssrc.json',
  '.postcssrc.yaml',
  '.postcssrc.yml',
  '.postcssrc.js',
  '.postcssrc.cjs',
  'postcss.config.js',
  'postcss.config.cjs'
]

function findPostCssConfig(projectPath: string): string | undefined {
  for (const configFile of postCssConfigFiles) {
    const configPath = path.join(projectPath, configFile)
    if (fs.existsSync(configPath)) {
      return configPath
    }
  }
  return undefined
}

function findBrowserslistSource(projectPath: string): string | undefined {
  // package.json browserslist
  const packageJsonPath = path.join(projectPath, 'package.json')
  try {
    if (fs.existsSync(packageJsonPath)) {
      const raw = fs.readFileSync(packageJsonPath, 'utf8')
      const pkg = JSON.parse(raw || '{}')
      if (pkg && pkg.browserslist) return `${packageJsonPath}#browserslist`
    }
  } catch {}

  // .browserslistrc or browserslist
  const candidates = [
    '.browserslistrc',
    'browserslist',
    '.browserslistrc.json',
    '.browserslistrc.yaml',
    '.browserslistrc.yml'
  ]
  for (const file of candidates) {
    const p = path.join(projectPath, file)
    if (fs.existsSync(p)) return p
  }
  return undefined
}
