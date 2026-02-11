// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {type Compiler} from '@rspack/core'
import {getMainWorldBridgeScripts} from './get-bridge-scripts'
import {findNearestPackageJsonSync} from '../../../../../webpack-lib/package-json'
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

  private resolveLoader(name: string): string {
    const base = path.resolve(__dirname, name)
    const candidates = [`${base}.cjs`, `${base}.js`, `${base}.mjs`, base]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    return base
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

    // 1- Add the content script wrapper. webpack-target-webextension
    // needs mounting and internal HMR code to work. This plugin abstracts
    // this away from the user. The contract requires the user to export a
    // default function that returns an optional cleanup function.
    compiler.options.module.rules.push({
      test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      include: includeDirs,
      exclude: [/([\\/])node_modules\1/],
      use: [
        {
          loader: this.resolveLoader('content-script-wrapper'),
          options: {
            manifestPath: this.manifestPath,
            mode: compiler.options.mode
          }
        }
      ]
    })

    if (compiler.options.mode !== 'production') {
      // 2- The wrapper above requires a default export.
      // This loader will warn if the script does not have a default export.
      compiler.options.module.rules.push({
        test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
        include: includeDirs,
        exclude: [/([\\/])node_modules\1/],
        use: [
          {
            loader: this.resolveLoader('warn-no-default-export'),
            options: {
              manifestPath: this.manifestPath,
              mode: compiler.options.mode
            }
          }
        ],
        enforce: 'pre'
      })

      // 3- Inject minimal HMR accept code for declared background and user scripts
      compiler.options.module.rules.push({
        test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
        include: includeDirs,
        exclude: [/([\\/])node_modules\1/],
        use: [
          {
            loader: this.resolveLoader('add-hmr-accept-code'),
            options: {
              manifestPath: this.manifestPath,
              mode: compiler.options.mode
            }
          }
        ]
      })
    }
  }
}
