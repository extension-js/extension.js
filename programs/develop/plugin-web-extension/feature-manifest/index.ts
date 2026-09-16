// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {isDebug} from '../../lib/messaging'
import type {DevOptions, FilepathList, PluginInterface} from '../../types'
import * as messages from './messages'
import {AddDependencies} from './steps/add-dependencies'
import {ApplyDevDefaults} from './steps/apply-dev-defaults'
import {EmitManifest} from './steps/emit-manifest'
import {ManifestLegacyWarnings} from './steps/legacy-warnings'
import {PatchWAR} from './steps/patch-war'
import {PersistManifestToDisk} from './steps/persist-manifest'
import {UpdateManifest} from './steps/update-manifest'
import {ValidateThemeValues} from './steps/validate-theme-values'

export class ManifestPlugin {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly includeList?: FilepathList
  private readonly devSession?: boolean

  constructor(options: PluginInterface & {browser: DevOptions['browser']}) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList
    this.devSession = options.devSession
  }

  public apply(compiler: Compiler) {
    if (isDebug()) {
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

    new ValidateThemeValues({
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
      browser: this.browser,
      devSession: this.devSession
    }).apply(compiler)

    // 5 - Persist the final manifest atomically so Chromium never
    // observes a partially written file during startup reloads.
    new PersistManifestToDisk().apply(compiler)

    new AddDependencies([this.manifestPath]).apply(compiler)

    new ManifestLegacyWarnings().apply(compiler)
  }
}
