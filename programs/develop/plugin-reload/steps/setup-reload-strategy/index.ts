// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {extensionSchemeFor} from '../../../lib/extension-base-from-stack'
import {parseAuthoredJson} from '../../../lib/parse-json-safe'
import {getBackgroundEntryName} from '../../../plugin-web-extension/feature-chunk-loading/background-entry-name'
import {buildContentScriptsMeta} from '../../../plugin-web-extension/feature-chunk-loading/content-scripts-meta'
import {filterKeysForThisBrowser} from '../../../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import {extensionBaseAttributeFor} from '../../../plugin-web-extension/feature-scripts/scripts-lib/taken-extension-base'
import type {DevOptions, Manifest, PluginInterface} from '../../../types'
import {SetupBackgroundEntry} from './setup-background-entry'
import WebExtension from './webpack-target-webextension-fork'

export class SetupReloadStrategy {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler) {
    const manifest: Manifest = parseAuthoredJson(
      fs.readFileSync(this.manifestPath, 'utf-8')
    )
    const patchedManifest = filterKeysForThisBrowser(manifest, this.browser)

    const contentScriptsMeta = buildContentScriptsMeta(patchedManifest)

    new SetupBackgroundEntry({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    new WebExtension({
      background: getBackgroundEntryName(patchedManifest, this.browser, {
        manifestDir: path.dirname(this.manifestPath),
        projectPath: compiler.options.context as string | undefined
      }),
      hmrConfig: false,
      weakRuntimeCheck: true,
      contentScriptsMeta,
      gecko: isGeckoBasedBrowser(String(this.browser)),
      baseAttribute: extensionBaseAttributeFor(this.manifestPath, this.browser),
      baseScheme: extensionSchemeFor(String(this.browser))
    }).apply(
      compiler as Parameters<InstanceType<typeof WebExtension>['apply']>[0]
    )

    // Hot update files drop the suffix the dev server adds, so a session
    // fetches and prunes them under hot/ by chunk and build hash alone.
    compiler.hooks.environment.tap('plugin-reload:hot-update-names', () => {
      const {output} = compiler.options

      if (output.hotUpdateChunkFilename !== undefined) {
        output.hotUpdateChunkFilename = 'hot/[id].[fullhash].js'
      }

      if (output.hotUpdateMainFilename !== undefined) {
        output.hotUpdateMainFilename = 'hot/[runtime].[fullhash].json'
      }
    })
  }
}
