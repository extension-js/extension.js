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
import {NOT_RAW_RESOURCE_QUERY} from '../../../lib/resource-query'
import type {PluginInterface} from '../../../types'
import {addRulesInFront} from '../scripts-lib/front-rules'
import {underFolders} from '../scripts-lib/path-conditions'

// Keep `import(chrome.runtime.getURL(...))` native: the argument is a runtime
// chrome-extension:// URL the bundler's module map can never satisfy.
export class KeepGetURLImportsNative {
  private readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  public apply(compiler: Compiler) {
    const packageJsonPath = findNearestProjectManifestSync(this.manifestPath)
    // The folders as written: a Windows short name reaches the bundler as is,
    // and the condition adds the real spelling itself.
    const includeDirs = [
      path.dirname(this.manifestPath),
      ...(packageJsonPath ? [path.dirname(packageJsonPath)] : [])
    ]

    // In front of the rules extension.config.js added, whose loaders run
    // first and so read the file as it is written.
    addRulesInFront(compiler, 'scripts:keep-geturl-imports-native', [
      {
        test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
        include: [underFolders(includeDirs)],
        exclude: [/([\\/])node_modules\1/],
        resourceQuery: NOT_RAW_RESOURCE_QUERY,
        use: [
          {
            loader: resolveDevelopDistFile(
              'feature-scripts-native-geturl-import-loader'
            )
          }
        ]
      }
    ])
  }
}
