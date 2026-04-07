import {Compilation, type Compiler, sources} from '@rspack/core'
import {stripDevServerStartupFromContentScript} from './remove-content-script-dev-server-runtime'

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

              if (strippedSource === originalSource) continue

              compilation.updateAsset(
                asset.name,
                new sources.RawSource(strippedSource)
              )
            }
          }
        )
      }
    )
  }
}
