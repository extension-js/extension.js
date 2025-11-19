import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import WebExtension from 'webpack-target-webextension'
import {createRequire} from 'node:module'
import {filterKeysForThisBrowser} from '../../scripts-lib/manifest'
import {SetupBackgroundEntry} from './setup-background-entry'
import {ApplyManifestDevDefaults} from './apply-manifest-dev-defaults'
import type {
  Manifest,
  PluginInterface,
  DevOptions
} from '../../../../webpack-types'

const requireForEsm = createRequire(import.meta.url)

function tryLoadWebExtensionFork():
  | (new (args: any) => {apply: (compiler: any) => void})
  | null {
  try {
    // prefer local fork when present (not shipped in CI)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = requireForEsm('./webpack-target-webextension-fork')
    return (mod && (mod.default || mod)) as any
  } catch {
    return null
  }
}

export class SetupReloadStrategy {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private getEntryName(manifest: Manifest) {
    if (manifest.background) {
      if (this.browser === 'firefox' || this.browser === 'gecko-based') {
        return {
          pageEntry: 'background/script',
          tryCatchWrapper: true,
          eagerChunkLoading: false
        }
      }

      if (manifest.manifest_version === 3) {
        return {
          serviceWorkerEntry: 'background/service_worker',
          tryCatchWrapper: true,
          eagerChunkLoading: false
        }
      }

      if (manifest.manifest_version === 2) {
        return {
          pageEntry: 'background/script',
          tryCatchWrapper: true,
          eagerChunkLoading: false
        }
      }
    }

    return {
      pageEntry: 'background',
      tryCatchWrapper: true,
      eagerChunkLoading: false
    }
  }

  public apply(compiler: Compiler) {
    // Guards are handled at the root plugin level

    const manifest: Manifest = JSON.parse(
      fs.readFileSync(this.manifestPath, 'utf-8')
    )
    const patchedManifest = filterKeysForThisBrowser(manifest, this.browser)

    // 1 - Apply the manifest defaults needed
    // for webpack-target-webextension to work correctly
    new ApplyManifestDevDefaults({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // 3 - Setup the background entry needed for webpack-target-webextension
    new SetupBackgroundEntry({
      manifestPath: this.manifestPath,
      browser: this.browser
    }).apply(compiler)

    // 4 - Now that we know the background exists, add the web extension target
    // using it. This is our core upstream plugin.
    const wantFork = process.env.EXTENSION_EXPERIMENTAL_HMR === 'true'

    if (wantFork) {
      const Fork = tryLoadWebExtensionFork()
      const PluginCtor = Fork || (WebExtension as any)
      new PluginCtor({
        background: this.getEntryName(patchedManifest),
        weakRuntimeCheck: true
      }).apply(compiler as any)
      return
    }

    new WebExtension({
      background: this.getEntryName(patchedManifest),
      weakRuntimeCheck: true
    }).apply(compiler as any)
  }
}
