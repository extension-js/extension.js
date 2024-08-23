import {Compiler} from '@rspack/core'
import {WebExtensionPluginOptions} from './types'

// Make dynamic import & chunk splitting works.
import {ChuckLoaderRuntimePlugin} from './ChunkLoader'
// Ban invalid file names in web extension
import {NoDangerNamePlugin} from './NoDangerNamePlugin'
// Provide support for MV3
import {ServiceWorkerEntryPlugin} from './ServiceWorkerPlugin'
// Automatically tweak HMR server
import {HMRDevServerPlugin} from './HMRDevServer'

export class WebExtensionPlugin {
  private readonly options: WebExtensionPluginOptions

  constructor(options: WebExtensionPluginOptions = {}) {
    const {background} = options
    if (background && (background.entry || background.manifest)) {
      console.warn(
        '[webpack-extension-target] background.entry and background.manifest ' +
          'has been deprecated.\n' +
          '- background.manifest is no longer needed.\n' +
          '- background.entry should be replaced with background.pageEntry ' +
          'and background.serviceWorkerEntry instead.'
      )

      if (background.pageEntry || background.serviceWorkerEntry) {
        throw new Error(
          '[webpack-extension-target] Deprecated background.entry and ' +
            'background.manifest cannot be specified with background.pageEntry ' +
            'or background.serviceWorkerEntry.'
        )
      }
    }
    this.options = options
  }

  apply(compiler: Compiler) {
    const {background} = this.options

    if (background) {
      if (background.serviceWorkerEntry) {
        if (background.serviceWorkerEntry === background.pageEntry) {
          // TODO: throw error in next version.
          console.warn(
            '[webpack-extension-target] background.serviceWorkerEntry must not ' +
              'be the same as background.pageEntry. Service Worker entry only ' +
              'supports importScript, but importScript does not exist in ' +
              'background page (mv2) or limited event page (mv3). A possible fix ' +
              'is to create two new files to be the service worker entry and the ' +
              'page entry, then those two files imports the background entry.'
          )
        }
        new ServiceWorkerEntryPlugin(
          background,
          background.serviceWorkerEntry
        ).apply(compiler)
      }

      if (background.manifest === 3 && background.entry) {
        new ServiceWorkerEntryPlugin(background, background.entry).apply(
          compiler
        )
      }
    }

    new ChuckLoaderRuntimePlugin(
      this.options.background || {},
      this.options.weakRuntimeCheck || false
    ).apply(compiler)

    new NoDangerNamePlugin().apply(compiler)

    if (this.options.hmrConfig !== false) {
      new HMRDevServerPlugin().apply(compiler)
    }
  }
}
