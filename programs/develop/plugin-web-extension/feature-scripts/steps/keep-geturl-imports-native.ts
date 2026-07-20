// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {resolveDevelopDistFile} from '../../../lib/develop-context'
import {findNearestProjectManifestSync} from '../../../lib/project-manifest'
import {canonicalizeDir, isResourceUnderDirs} from '../../../lib/resource-path'
import type {PluginInterface} from '../../../types'

// Keep `import(chrome.runtime.getURL(...))` native: the argument is a runtime
// chrome-extension:// URL the bundler's module map can never satisfy.
export class KeepGetURLImportsNative {
  private readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
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

    compiler.options.module.rules.push({
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      include: [
        (resource: string) => isResourceUnderDirs(resource, includeDirs)
      ],
      exclude: [/([\\/])node_modules\1/],
      use: [
        {
          loader: resolveDevelopDistFile(
            'feature-scripts-native-geturl-import-loader'
          )
        }
      ]
    })
  }
}
