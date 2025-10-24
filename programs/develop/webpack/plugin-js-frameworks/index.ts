import * as path from 'path'
import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import {PluginInterface} from '../webpack-types'
import {maybeUseBabel} from './js-tools/babel'
import {isUsingPreact, maybeUsePreact} from './js-tools/preact'
import {isUsingReact, maybeUseReact} from './js-tools/react'
import {maybeUseVue} from './js-tools/vue'
import {
  isUsingTypeScript,
  getUserTypeScriptConfigFile
} from './js-tools/typescript'
import {maybeUseSvelte} from './js-tools/svelte'
import {type DevOptions} from '../../types/options'
// import {maybeUseAngular} from './js-tools/angular'
// import {maybeUseSolid} from './js-tools/solid'

export class JsFrameworksPlugin {
  public static readonly name: string = 'plugin-js-frameworks'
  public readonly manifestPath: string
  public readonly mode: DevOptions['mode']

  constructor(options: PluginInterface & {mode: DevOptions['mode']}) {
    this.manifestPath = options.manifestPath
    this.mode = options.mode
  }

  private async configureOptions(compiler: Compiler) {
    const mode = compiler.options.mode || 'development'
    const projectPath = path.dirname(this.manifestPath)
    const packageRoot = path.resolve(projectPath, '..')

    const maybeInstallBabel = await maybeUseBabel(compiler, projectPath)
    const maybeInstallReact = await maybeUseReact(projectPath)
    const maybeInstallPreact = await maybeUsePreact(projectPath)
    const maybeInstallVue = await maybeUseVue(projectPath)
    const maybeInstallSvelte = await maybeUseSvelte(projectPath, mode)
    const tsConfigPath = getUserTypeScriptConfigFile(projectPath)
    const manifestDir = path.dirname(this.manifestPath)
    const tsRoot = tsConfigPath ? path.dirname(tsConfigPath) : manifestDir
    const preferTypeScript = !!tsConfigPath || isUsingTypeScript(projectPath)

    // Derive transpile targets from extension manifest for leaner output
    let targets: string[] = ['chrome >= 100']

    try {
      const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'))
      if (manifest?.minimum_chrome_version) {
        targets = [`chrome >= ${manifest.minimum_chrome_version}`]
      }

      const geckoMin =
        manifest?.browser_specific_settings?.gecko?.strict_min_version ||
        manifest?.applications?.gecko?.strict_min_version

      if (geckoMin) {
        const major = parseInt(String(geckoMin).split('.')[0], 10)

        if (!Number.isNaN(major)) {
          targets.push(`firefox >= ${major}`)
        }
      }
    } catch {
      // Fail silently
    }

    compiler.options.resolve.alias = {
      ...(maybeInstallBabel?.alias || {}),
      ...(maybeInstallReact?.alias || {}),
      ...(maybeInstallPreact?.alias || {}),
      ...(maybeInstallVue?.alias || {}),
      ...(maybeInstallSvelte?.alias || {}),
      ...compiler.options.resolve.alias
    }

    compiler.options.module.rules = [
      {
        test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
        include: Array.from(new Set([tsRoot, manifestDir])),
        exclude: [/[\\/]node_modules[\\/]/],
        use: {
          loader: 'builtin:swc-loader',
          options: {
            sync: true,
            module: {
              type: 'es6'
            },
            minify: mode === 'production',
            isModule: true,
            sourceMap: this.mode === 'development',
            env: {targets},
            jsc: {
              parser: {
                syntax: preferTypeScript ? 'typescript' : 'ecmascript',
                tsx: preferTypeScript
                  ? true
                  : isUsingTypeScript(projectPath) &&
                    (isUsingReact(projectPath) || isUsingPreact(projectPath)),
                jsx:
                  !preferTypeScript &&
                  (isUsingReact(projectPath) || isUsingPreact(projectPath)),
                dynamicImport: true
              },
              transform: {
                react: {
                  development: mode === 'development',
                  refresh: mode === 'development',
                  runtime: 'automatic',
                  importSource: 'react',
                  ...(isUsingPreact(projectPath)
                    ? {
                        pragma: 'h',
                        pragmaFrag: 'Fragment',
                        throwIfNamespace: true,
                        useBuiltins: false
                      }
                    : {})
                }
              }
            }
          }
        }
      },
      ...(maybeInstallBabel?.loaders || []),
      ...(maybeInstallReact?.loaders || []),
      ...(maybeInstallPreact?.loaders || []),
      ...(maybeInstallVue?.loaders || []),
      ...(maybeInstallSvelte?.loaders || []),
      ...compiler.options.module.rules
    ].filter(Boolean)

    maybeInstallReact?.plugins?.forEach((plugin) => plugin.apply(compiler))
    maybeInstallPreact?.plugins?.forEach((plugin) => plugin.apply(compiler))
    maybeInstallVue?.plugins?.forEach((plugin) => plugin.apply(compiler))
    maybeInstallSvelte?.plugins?.forEach((plugin) => plugin.apply(compiler))

    if (isUsingTypeScript(projectPath) || !!tsConfigPath) {
      compiler.options.resolve.tsConfig = {
        configFile: tsConfigPath as string
      }
    }
  }

  public async apply(compiler: Compiler) {
    const mode = compiler.options.mode || 'development'
    if (mode === 'production') {
      compiler.hooks.beforeRun.tapPromise(
        JsFrameworksPlugin.name,
        async () => await this.configureOptions(compiler)
      )
      return
    }
    await this.configureOptions(compiler)
  }
}
