// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import {type Compiler} from '@rspack/core'
import {findNearestProjectManifestSync} from '../../../../../lib/project-manifest'
import {resolveDevelopDistFile} from '../../../../../lib/develop-context'
import {
  canonicalizeDir,
  isResourceUnderDirs
} from '../../../../../lib/resource-path'
import {getMainWorldBridgeScripts} from './get-bridge-scripts'
import type {
  PluginInterface,
  DevOptions,
  FilepathList
} from '../../../../../types'

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

  private resolveConcatLoader(): string {
    return resolveDevelopDistFile('feature-scripts-classic-concat-loader')
  }

  public apply(compiler: Compiler) {
    const manifestDir = canonicalizeDir(path.dirname(this.manifestPath))
    const packageJsonPath = findNearestProjectManifestSync(this.manifestPath)
    const packageJsonDir = canonicalizeDir(
      packageJsonPath ? path.dirname(packageJsonPath) : manifestDir
    )
    const includeDirs =
      packageJsonDir === manifestDir
        ? [manifestDir]
        : [manifestDir, packageJsonDir]
    const includeMatcher = (resource: string): boolean =>
      isResourceUnderDirs(resource, includeDirs)

    // Classic concat loader: runs on files that carry the
    // __extensionjs_classic_concat__ query parameter. Must be registered
    // before the content-script-wrapper so the wrapper receives the
    // concatenated source + source map from the concat loader.
    compiler.options.module.rules.push({
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      resourceQuery: /__extensionjs_classic_concat__/,
      include: [includeMatcher],
      exclude: [/([\\/])node_modules\1/],
      use: [
        {
          loader: this.resolveLoader(),
          options: {
            manifestPath: this.manifestPath,
            mode: compiler.options.mode
          }
        },
        {
          loader: this.resolveConcatLoader()
        }
      ]
    })

    compiler.options.module.rules.push({
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      include: [includeMatcher],
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
