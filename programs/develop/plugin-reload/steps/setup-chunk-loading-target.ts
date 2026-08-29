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
import {stripBom} from '../../lib/parse-json-safe'
import {filterKeysForThisBrowser} from '../../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import type {DevOptions, Manifest, PluginInterface} from '../../types'
import {
  buildContentScriptsMeta,
  getBackgroundEntryName
} from './setup-reload-strategy'
import WebExtension from './setup-reload-strategy/webpack-target-webextension-fork'

/**
 * How a chunk gets loaded is a property of the extension platform, not of dev
 * mode. Without this, a production build falls back to rspack's web target,
 * whose loader appends a `<script>` to the host document: that runs in the MAIN
 * world while the content script lives in the isolated world, so the chunk never
 * reaches the requester and a dynamic `import()` dies with ChunkLoadError. Dev
 * looked fine only because the target rode along inside the reload plugin
 * (issue #507).
 *
 * This is the target ALONE. Everything reload-specific, including the
 * synthesized background entry, stays in SetupReloadStrategy: production must
 * never gain a background script the author did not write.
 */
export class SetupChunkLoadingTarget {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    // Dev registers the same target through SetupReloadStrategy, which also
    // owns the reload-only steps. Applying both would install it twice.
    if (compiler.options.mode !== 'production') return

    const hasValidManifest =
      !!this.manifestPath &&
      fs.existsSync(this.manifestPath) &&
      fs.lstatSync(this.manifestPath).isFile()

    if (!hasValidManifest) return

    let patchedManifest: Manifest
    try {
      const manifest: Manifest = JSON.parse(
        stripBom(fs.readFileSync(this.manifestPath, 'utf-8'))
      )
      patchedManifest = filterKeysForThisBrowser(manifest, this.browser)
    } catch {
      // An unreadable manifest is reported by the manifest feature; a build
      // that is failing anyway must not also fail here.
      return
    }

    new WebExtension({
      background: {
        ...getBackgroundEntryName(patchedManifest, this.browser, {
          manifestDir: path.dirname(this.manifestPath),
          projectPath: compiler.options.context as string | undefined
        }),
        // The classic loader adds a background runtime module that asks the
        // service worker to inject chunks for a content script. A production
        // background usually optimizes down to a bundle with no webpack
        // runtime at all, and the module then lands bare at the top of the
        // file, where __webpack_require__ does not exist and the worker dies
        // on load. The isolated world reaches its chunks through the native
        // dynamic import loader, so production does not need this fallback.
        // The reader is `background.classicLoader`, not the top-level key.
        classicLoader: false
      },
      hmrConfig: false,
      weakRuntimeCheck: true,
      contentScriptsMeta: buildContentScriptsMeta(patchedManifest)
    }).apply(
      compiler as Parameters<InstanceType<typeof WebExtension>['apply']>[0]
    )
  }
}
