// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import {findNearestPackageJsonSync} from '../../../scripts-lib/package-json'
import {resolveDevelopDistFile} from '../../../../../lib/develop-context'
import {getMainWorldBridgeScripts} from './get-bridge-scripts'
import type {
  PluginInterface,
  DevOptions,
  FilepathList
} from '../../../../../types'

// rspack matches a loader rule's `include` against the module's canonical
// (symlink-resolved) resource path. When the project lives under a symlinked
// path — macOS `$TMPDIR` (/var -> /private/var), some CI/devcontainer temp dirs
// — the raw `path.dirname(manifestPath)` is NOT canonical, so `include` fails to
// match the content-script entry, the wrapper loader never runs, and the content
// script loses its `__EXTENSIONJS_mount` call (it stops self-mounting). Resolve
// the include dirs to their real path so they match. Best-effort: fall back to
// the raw path if realpath fails (e.g. the dir does not exist yet).
function canonicalizeDir(dir: string): string {
  try {
    return fs.realpathSync.native(dir)
  } catch {
    try {
      return fs.realpathSync(dir)
    } catch {
      return dir
    }
  }
}

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
    const packageJsonPath = findNearestPackageJsonSync(this.manifestPath)
    const packageJsonDir = canonicalizeDir(
      packageJsonPath ? path.dirname(packageJsonPath) : manifestDir
    )
    const includeDirs =
      packageJsonDir === manifestDir
        ? [manifestDir]
        : [manifestDir, packageJsonDir]

    // Classic concat loader: runs on files that carry the
    // __extensionjs_classic_concat__ query parameter. Must be registered
    // before the content-script-wrapper so the wrapper receives the
    // concatenated source + source map from the concat loader.
    compiler.options.module.rules.push({
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      resourceQuery: /__extensionjs_classic_concat__/,
      include: includeDirs,
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
