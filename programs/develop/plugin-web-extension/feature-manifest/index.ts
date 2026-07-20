// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import type {DevOptions, FilepathList, PluginInterface} from '../../types'
import * as messages from './messages'
import {AddDependencies} from './steps/add-dependencies'
import {ApplyDevDefaults} from './steps/apply-dev-defaults'
import {EmitManifest} from './steps/emit-manifest'
import {ManifestLegacyWarnings} from './steps/legacy-warnings'
import {PatchWAR} from './steps/patch-war'
import {PersistManifestToDisk} from './steps/persist-manifest'
import {UpdateManifest} from './steps/update-manifest'

/**
 * ManifestPlugin is responsible for handling the manifest.json file.
 * It ensures that the files defined in the manifest have valid paths,
 * throwing errors if they don't. It also ensures the manifest is emitted
 * to the assets bundle, so other plugins can modify it, and stored
 * as file dependency so webpack can watch and trigger changes.
 *
 * The plugin also has a guard against recompiling entrypoints
 * at runtime, throwing an error if any of those files change.
 */
export class ManifestPlugin {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface & {browser: DevOptions['browser']}) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList
  }

  public apply(compiler: Compiler) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        messages.manifestIncludeSummary(
          String(this.browser || 'chrome'),
          this.manifestPath
        )
      )
    }

    new EmitManifest({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    new UpdateManifest({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // 3 - Patch web_accessible_resources from content script imports.
    // Depends on CollectContentEntryImports (WebResourcesPlugin) at SUMMARIZE.
    new PatchWAR({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    new ApplyDevDefaults({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // 5 - Persist the final manifest atomically so Chromium never
    // observes a partially written file during startup reloads.
    new PersistManifestToDisk().apply(compiler)

    new AddDependencies([this.manifestPath]).apply(compiler)

    new ManifestLegacyWarnings().apply(compiler)
  }
}
