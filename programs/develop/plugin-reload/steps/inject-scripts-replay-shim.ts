// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, sources} from '@rspack/core'
import {SCRIPTS_REPLAY_SHIM_SOURCE} from '../reload-lib/scripts-replay-shim'

const BACKGROUND_ASSET = /(^|\/)background\/(?:service_worker|script)\.js$/i

// Prepends the dev-only scripts-replay shim to the compiled background asset.
// A processAssets post-process (not BannerPlugin) so only that asset is touched.
export class InjectScriptsReplayShim {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      InjectScriptsReplayShim.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: InjectScriptsReplayShim.name,
            // Run late, after StripContentScriptDevServerRuntime, so its
            // source modifications don't undo our prepend.
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 100
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (!BACKGROUND_ASSET.test(asset.name)) continue
              const original = asset.source.source().toString()
              if (original.indexOf('__extjsScriptsReplayInstalled') !== -1) {
                continue
              }
              const next = `${SCRIPTS_REPLAY_SHIM_SOURCE}\n${original}`
              compilation.updateAsset(asset.name, new sources.RawSource(next))
            }
          }
        )
      }
    )
  }
}
