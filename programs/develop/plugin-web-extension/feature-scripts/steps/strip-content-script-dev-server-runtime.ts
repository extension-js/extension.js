// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {Compilation, type Compiler, sources, WebpackError} from '@rspack/core'
import {
  stripDevServerStartupFromContentScript,
  contentScriptRetainsDevServerRuntime
} from './remove-content-script-dev-server-runtime'

const CONTENT_SCRIPT_ASSET =
  /(^|\/)content_scripts\/content-\d+(?:\.[a-f0-9]+)?\.js$/i

export class StripContentScriptDevServerRuntime {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      StripContentScriptDevServerRuntime.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: StripContentScriptDevServerRuntime.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (!CONTENT_SCRIPT_ASSET.test(asset.name)) continue

              const originalSource = asset.source.source().toString()
              const strippedSource =
                stripDevServerStartupFromContentScript(originalSource)

              if (strippedSource !== originalSource) {
                compilation.updateAsset(
                  asset.name,
                  new sources.RawSource(strippedSource)
                )
              }

              if (contentScriptRetainsDevServerRuntime(strippedSource)) {
                const warning = new WebpackError(
                  `Could not strip the dev-server runtime from ${asset.name}. ` +
                    `This usually means the bundler's output format changed and ` +
                    `Extension.js needs an update. The content script may try to ` +
                    `open a dev-server connection on the host page. Please report ` +
                    `this at https://github.com/extension-js/extension.js/issues.`
                ) as Error & {file?: string; name?: string}
                warning.name = 'ContentScriptDevServerRuntimeWarning'
                warning.file = asset.name
                compilation.warnings ||= []
                compilation.warnings.push(warning)
              }
            }
          }
        )
      }
    )
  }
}
