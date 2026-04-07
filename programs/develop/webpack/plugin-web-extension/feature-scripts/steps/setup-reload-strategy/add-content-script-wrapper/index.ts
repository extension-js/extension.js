// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import {type Compiler} from '@rspack/core'
import {findNearestPackageJsonSync} from '../../../scripts-lib/package-json'
import {resolveDevelopDistFile} from '../../../../../optional-deps-lib/runtime-context'
import {getMainWorldBridgeScripts} from './get-bridge-scripts'
import type {
  PluginInterface,
  DevOptions,
  FilepathList
} from '../../../../../webpack-types'

export class AddContentScriptWrapper {
  public static getBridgeScripts(manifestPath: string): FilepathList {
    return getMainWorldBridgeScripts(manifestPath)
  }

  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = (options.browser as DevOptions['browser']) || 'chrome'
  }

  private resolveLoader(): string {
    return resolveDevelopDistFile('feature-scripts-content-script-wrapper')
  }

  public apply(compiler: Compiler) {
    const manifestDir = path.dirname(this.manifestPath)
    const packageJsonPath = findNearestPackageJsonSync(this.manifestPath)
    const packageJsonDir = packageJsonPath
      ? path.dirname(packageJsonPath)
      : manifestDir
    const includeDirs =
      packageJsonDir === manifestDir
        ? [manifestDir]
        : [manifestDir, packageJsonDir]

    compiler.options.module.rules.push({
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      include: includeDirs,
      exclude: [/([\\/])node_modules\1/],
      use: [
        {
          loader: this.resolveLoader(),
          options: {
            manifestPath: this.manifestPath,
            mode: compiler.options.mode
          }
        }
      ]
    })
  }
}
