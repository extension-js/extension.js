import path from 'path'
import webpack from 'webpack'

import {IncludeList, type ScriptsPluginInterface} from './types'
import AddScriptsAndStyles from './steps/AddScriptsAndStyles'
import AddHmrAcceptCode from './steps/AddHmrAcceptCode'
import AddDynamicCssImport from './steps/AddDynamicCssImport'

/**
 * ScriptsPlugin is responsible for handiling all possible JavaScript
 * (and CSS, for content_scripts) fields in manifest.json. It also
 * supports extra scripts defined via this.include option. These
 * extra scripts are added to the compilation and are also HMR
 * enabled. They are useful for adding extra scripts to the
 * extension runtime, like content_scripts via `scripting`, for example.
 *
 * Features supported:
 * - content_scripts.js - HMR enabled
 * - content_scripts.css - HMR enabled
 * - background.scripts - HMR enabled
 * - service_worker - Reloaded by chrome.runtime.reload()
 * - user_scripts.api_scripts - HMR enabled
 * - scripts via this.include - HMR enabled
 */
export default class ScriptsPlugin {
  public readonly manifestPath: string
  public readonly include?: string[]
  public readonly exclude?: string[]

  constructor(options: ScriptsPluginInterface) {
    this.manifestPath = options.manifestPath
    this.include = options.include || []
    this.exclude = options.exclude || []
  }

  private parseIncludes(includes: string[]): IncludeList {
    if (!includes.length) return {}
    return includes.reduce((acc, include) => {
      const extname = path.extname(include)
      const basename = path.basename(include, extname)
      const entryname = basename === 'index' ? path.dirname(include) : basename

      return {
        ...acc,
        [`scripts/${entryname}`]: include
      }
    }, {})
  }

  public apply(compiler: webpack.Compiler): void {
    // 1 - Adds the scripts entries from the manifest file
    // (and stylesheets for content_scripts) and also
    // from the extra scripts defined in this.include
    // to the compilation.
    new AddScriptsAndStyles({
      manifestPath: this.manifestPath,
      includeList: this.parseIncludes(this.include || []),
      exclude: this.exclude || []
    }).apply(compiler)

    // 2 - Ensure scripts are HMR enabled by adding the HMR accept code.
    AddHmrAcceptCode(compiler, this.manifestPath)

    // 3 - Ensure css for content_scripts defined in manifest.json
    // are HMR enabled by adding them as dynamic imports to the entry point.
    AddDynamicCssImport(compiler, this.manifestPath)
  }
}
