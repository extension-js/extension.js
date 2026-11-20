//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'
import {isChromiumBasedBrowser} from '../../../lib/constants'
import * as messages from '../../../lib/messages'

interface WarnManifestV2OnChromiumOptions {
  manifest: Record<string, unknown> | undefined
  browser: string
}

// Warn (don't fail) when an MV2 source is built for a Chromium target:
// Chrome no longer loads MV2 and Edge has deprecated it.
export class WarnManifestV2OnChromium {
  constructor(private readonly options: WarnManifestV2OnChromiumOptions) {}

  apply(compiler: Compiler): void {
    const {manifest} = this.options
    const target = String(this.options.browser)
    // Family classification: brave/opera/vivaldi/yandex inherit Chromium's removal.
    const isChromiumTarget = isChromiumBasedBrowser(target)
    // Chrome classifies any manifest carrying a theme key as a theme and
    // still installs MV2 themes, so only extension manifests get the warning.
    const isThemeManifest = Boolean(
      manifest?.theme && typeof manifest.theme === 'object'
    )

    if (
      manifest?.manifest_version !== 2 ||
      !isChromiumTarget ||
      isThemeManifest
    ) {
      return
    }

    // A dev session recompiles on every save, and the verdict does not
    // change between saves, so it is said once per session.
    let reported = false

    compiler.hooks.thisCompilation.tap(
      'warn-mv2-on-chromium',
      (compilation: Compilation) => {
        if (compiler.options.mode === 'development') {
          if (reported) return

          reported = true
        }

        const ErrorCtor = compiler.rspack?.WebpackError || Error
        const usesBlockingWebRequest =
          Array.isArray(manifest.permissions) &&
          (manifest.permissions as unknown[]).includes('webRequestBlocking')
        const warning = new ErrorCtor(
          messages.manifestV2OnChromium(target, usesBlockingWebRequest)
        )
        warning.name = 'ManifestV2OnChromiumWarning'
        compilation.warnings.push(warning)
      }
    )
  }
}
