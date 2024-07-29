import path from 'path'
import {type Compiler} from 'webpack'
import {PluginInterface} from '../types'
import {DevOptions} from '../../develop-types'
import {maybeUseBabel} from './js-tools/babel'
import {maybeUsePreact} from './js-tools/preact'
import {maybeUseReact} from './js-tools/react'
import {maybeUseVue} from './js-tools/vue'
// import {maybeUseAngular} from './js-tools/angular'
// import {maybeUseSvelte} from './js-tools/svelte'
// import {maybeUseSolid} from './js-tools/solid'

export class JsFrameworksPlugin {
  public static readonly name: string = 'plugin-js-frameworks'

  public readonly manifestPath: string
  public readonly mode: DevOptions['mode']

  constructor(options: PluginInterface & {mode: DevOptions['mode']}) {
    this.manifestPath = options.manifestPath
    this.mode = options.mode
  }

  public async apply(compiler: Compiler) {
    const projectPath = path.dirname(this.manifestPath)

    const maybeInstallBabel = await maybeUseBabel(compiler, projectPath)
    const maybeInstallReact = await maybeUseReact(compiler, projectPath)
    const maybeInstallPreact = await maybeUsePreact(compiler, projectPath)
    const maybeInstallVue = await maybeUseVue(compiler, projectPath)

    compiler.options.resolve.alias = {
      ...compiler.options.resolve.alias,
      ...(maybeInstallBabel?.alias || {}),
      ...(maybeInstallReact?.alias || {}),
      ...(maybeInstallPreact?.alias || {}),
      ...(maybeInstallVue?.alias || {})
    }

    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...(maybeInstallBabel?.loaders || []),
      ...(maybeInstallReact?.loaders || []),
      ...(maybeInstallPreact?.loaders || []),
      ...(maybeInstallVue?.loaders || [])
    ].filter(Boolean)

    maybeInstallReact?.plugins?.forEach((plugin) => plugin.apply(compiler))
    maybeInstallPreact?.plugins?.forEach((plugin) => plugin.apply(compiler))
    maybeInstallVue?.plugins?.forEach((plugin) => plugin.apply(compiler))
  }
}
