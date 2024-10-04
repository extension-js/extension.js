import path from 'path'
import {type Compiler} from 'webpack'
import {PluginInterface} from '../webpack-types'
import {maybeUseBabel} from './js-tools/babel'
import {isUsingPreact, maybeUsePreact} from './js-tools/preact'
import {isUsingReact, maybeUseReact} from './js-tools/react'
import {maybeUseVue} from './js-tools/vue'
import {isUsingTypeScript} from './js-tools/typescript'
import {maybeUseSvelte} from './js-tools/svelte'
// import {maybeUseAngular} from './js-tools/angular'
// import {maybeUseSolid} from './js-tools/solid'

export class JsFrameworksPlugin {
  public static readonly name: string = 'plugin-js-frameworks'

  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private async configureOptions(compiler: Compiler) {
    const mode = compiler.options.mode || 'development'
    const projectPath = path.dirname(this.manifestPath)

    const maybeInstallBabel = await maybeUseBabel(compiler, projectPath)
    const maybeInstallReact = await maybeUseReact(projectPath)
    const maybeInstallPreact = await maybeUsePreact(projectPath)
    const maybeInstallVue = await maybeUseVue(projectPath)
    const maybeInstallSvelte = await maybeUseSvelte(projectPath)

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
        include: [path.dirname(this.manifestPath)],
        exclude: /node_modules/,
        use: {
          loader: require.resolve('swc-loader'),
          options: {
            sync: true,
            module: {
              type: 'es6'
            },
            minify: mode === 'production',
            isModule: true,
            jsc: {
              target: 'es2016',
              parser: {
                syntax: isUsingTypeScript(projectPath)
                  ? 'typescript'
                  : 'ecmascript',
                tsx:
                  isUsingTypeScript(projectPath) &&
                  (isUsingReact(projectPath) || isUsingPreact(projectPath)),
                jsx:
                  !isUsingTypeScript(projectPath) &&
                  (isUsingReact(projectPath) || isUsingPreact(projectPath)),
                dynamicImport: true
              },
              transform: {
                react: {
                  development: mode === 'development',
                  refresh: mode === 'development',
                  runtime: 'automatic',
                  importSource: 'react'
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
