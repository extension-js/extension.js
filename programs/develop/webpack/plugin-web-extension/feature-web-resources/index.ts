// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {Compiler} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import {CollectContentEntryImports} from './steps/collect-content-entry-imports'

/**
 * ResourcesPlugin collects content script imports for manifest WAR patching.
 * Actual manifest patching is done by ManifestPlugin (PatchWAR step) so all
 * manifest writes stay consolidated in feature-manifest.
 *
 * Feature supported:
 *
 * - Collects assets imported from content_scripts files.
 * - WAR patching uses this data (via getSharedFor) in manifest:patch-war.
 */
export class WebResourcesPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser || 'chrome'
  }

  apply(compiler: Compiler) {
    new CollectContentEntryImports({
      manifestPath: this.manifestPath,
      includeList: this.includeList
    }).apply(compiler)
  }
}
