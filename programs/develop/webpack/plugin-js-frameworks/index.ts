import path from 'path'
import {type WebpackPluginInstance, type Compiler} from 'webpack'
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

    const plugins: WebpackPluginInstance[] = []

    const maybeInstallReact = await maybeUseReact(projectPath, this.mode)
    plugins.push(...maybeInstallReact)

    compiler.options.plugins = [...compiler.options.plugins, ...plugins].filter(
      Boolean
    )

    const maybeInstallBabel = await maybeUseBabel(projectPath, this.mode)
    const maybeInstallVue = await maybeUseVue(projectPath)

    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...maybeInstallBabel,
      ...maybeInstallVue
    ].filter(Boolean)

    const maybeInstallPreact = maybeUsePreact(projectPath)

    compiler.options.resolve.alias = maybeInstallPreact
  }
}
