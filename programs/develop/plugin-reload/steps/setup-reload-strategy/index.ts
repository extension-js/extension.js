// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {extendChunkLoadingTarget} from '../../../plugin-web-extension/shared/chunk-loading-target-extensions'
import type {DevOptions, PluginInterface} from '../../../types'
import {SetupBackgroundEntry} from './setup-background-entry'

export class SetupReloadStrategy {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler) {
    const backgroundEntry = new SetupBackgroundEntry({
      manifestPath: this.manifestPath,
      browser: this.browser
    })
    backgroundEntry.apply(compiler)

    // The browser runs the authored background when there is one, and the
    // one this session generated otherwise. The fallback is answered there.
    extendChunkLoadingTarget(compiler, {
      fallbackBackground: (authored) =>
        authored.pageEntry || authored.serviceWorkerEntry
          ? authored
          : (backgroundEntry.generated ?? authored)
    })
  }
}
