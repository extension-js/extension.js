// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {debugLine, isDebug} from '../../lib/messaging'
import type {DevOptions, PluginInterface} from '../../types'
import {PatchWAR} from '../feature-web-resources/steps/patch-war'
import * as messages from './messages'
import {AddDependencies} from './steps/add-dependencies'
import {ApplyDevDefaults} from './steps/apply-dev-defaults'
import {EmitManifest} from './steps/emit-manifest'
import {ManifestLegacyWarnings} from './steps/legacy-warnings'
import {PersistManifestToDisk} from './steps/persist-manifest'
import {UpdateManifest} from './steps/update-manifest'
import {ValidateThemeArrays} from './steps/validate-theme-values'
import {WarnContentScriptHostAccess} from './steps/warn-content-script-host-access'
import {WarnDescriptionLength} from './steps/warn-description-length'
import {WarnIgnoredHostPermissions} from './steps/warn-ignored-host-permissions'
import {WarnUndeclaredPermissions} from './steps/warn-undeclared-permissions'
import {WarnWebAssembly} from './steps/warn-webassembly'

export class ManifestPlugin {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  private readonly devSession?: boolean
  private readonly connectableHost?: string

  constructor(options: PluginInterface & {browser: DevOptions['browser']}) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
    this.connectableHost = options.connectableHost
  }

  public apply(compiler: Compiler) {
    if (isDebug()) {
      debugLine(
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

    new ValidateThemeArrays({
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
      devSession: this.devSession,
      connectableHost: this.connectableHost
    }).apply(compiler)

    new WarnUndeclaredPermissions({
      manifestPath: this.manifestPath,
      browser: this.browser,
      devSession: this.devSession
    }).apply(compiler)

    // 5 - Persist the final manifest atomically so Chromium never
    // observes a partially written file during startup reloads.
    new PersistManifestToDisk({manifestPath: this.manifestPath}).apply(compiler)

    new WarnDescriptionLength({browser: this.browser}).apply(compiler)

    new WarnIgnoredHostPermissions().apply(compiler)

    new WarnContentScriptHostAccess({browser: this.browser}).apply(compiler)

    new WarnWebAssembly({browser: this.browser}).apply(compiler)

    new AddDependencies([this.manifestPath]).apply(compiler)

    new ManifestLegacyWarnings().apply(compiler)
  }
}
