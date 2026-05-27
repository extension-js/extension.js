// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {Compilation, type Compiler, sources} from '@rspack/core'
import {buildBridgeProducerSource} from '../../../../dev-server/control-bridge/producer-runtime'

const BACKGROUND_ASSET = /(^|\/)background\/(?:service_worker|script)\.js$/i

/**
 * Prepends the agent-bridge producer to the compiled background SW so the
 * user extension forwards its console output to the dev-server control WS
 * (agent bridge). The control port + instanceId are read from process.env
 * (set by dev-server/index.ts); when the bridge is unavailable the builder
 * returns '' and nothing is injected.
 *
 * Mirrors InjectScriptsReplayShim: a late processAssets post-process that only
 * touches the background entry, independent of banner-emission ordering.
 */
export class InjectBridgeProducer {
  apply(compiler: Compiler) {
    const controlPort = parseInt(
      String(process.env.EXTENSION_CONTROL_PORT || ''),
      10
    )
    const instanceId = String(process.env.EXTENSION_INSTANCE_ID || '')
    const source = buildBridgeProducerSource({
      controlPort: Number.isFinite(controlPort) ? controlPort : null,
      instanceId,
      context: 'background'
    })

    if (!source) return // bridge unavailable — nothing to inject

    compiler.hooks.thisCompilation.tap(
      InjectBridgeProducer.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: InjectBridgeProducer.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 101
          },
          () => {
            for (const asset of compilation.getAssets()) {
              if (!BACKGROUND_ASSET.test(asset.name)) continue

              const original = asset.source.source().toString()
              if (original.indexOf('__extjsBridgeProducerInstalled') !== -1) {
                continue
              }

              const next = source + '\n' + original
              compilation.updateAsset(asset.name, new sources.RawSource(next))
            }
          }
        )
      }
    )
  }
}
