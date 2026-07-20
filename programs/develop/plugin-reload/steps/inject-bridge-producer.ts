// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, sources} from '@rspack/core'
import {buildBridgeProducerSource} from '../../dev-server/control-bridge/producer-runtime'

// Matches the compiled background entry across engines: Chromium emits
// background/service_worker.js, Firefox background/scripts.js; scripts? covers both.
const BACKGROUND_ASSET = /(^|\/)background\/(?:service_worker|scripts?)\.js$/i

// Prepends the agent-bridge producer to the compiled background SW; control
// port + instanceId come from process.env, nothing injected when unavailable.
export class InjectBridgeProducer {
  apply(compiler: Compiler) {
    const controlPort = parseInt(
      String(process.env.EXTENSION_CONTROL_PORT || ''),
      10
    )
    const instanceId = String(process.env.EXTENSION_INSTANCE_ID || '')
    // Connectable host of the control WS (loopback locally; the public host for
    // remote/devcontainer). Resolved once by dev-server/index.ts.
    const host =
      String(process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST || '').trim() ||
      '127.0.0.1'
    const source = buildBridgeProducerSource({
      controlPort: Number.isFinite(controlPort) ? controlPort : null,
      instanceId,
      context: 'background',
      host
    })

    if (!source) return

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

              const next = `${source}\n${original}`
              compilation.updateAsset(asset.name, new sources.RawSource(next))
            }
          }
        )
      }
    )
  }
}
