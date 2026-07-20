// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, sources} from '@rspack/core'
import {buildBridgeRelaySource} from '../../dev-server/control-bridge/producer-runtime'

// Map an output-asset entry to the bridge context it runs in. Extension.js emits
// surfaces under canonical dirs (action=popup, options, sidebar=side_panel,
// devtools) and content scripts under content_scripts/. The background SW
// (background/service_worker.js) and HMR chunks (hot/*) are DELIBERATELY excluded:
// the SW already runs the producer, and relay-injecting it would double-patch
// console and loop sendMessage back to itself.
const RELAY_TARGETS: ReadonlyArray<{re: RegExp; context: string}> = [
  {re: /(^|\/)content_scripts\/.+\.js$/i, context: 'content'},
  {re: /(^|\/)action\/index\.js$/i, context: 'popup'},
  {re: /(^|\/)options\/index\.js$/i, context: 'options'},
  {re: /(^|\/)sidebar\/index\.js$/i, context: 'sidebar'},
  {re: /(^|\/)devtools\/index\.js$/i, context: 'devtools'},
  // chrome_url_overrides pages are extension pages a tab-targeted
  // chrome.scripting can never reach (the extension can't be granted host
  // permission to itself, §63); the relay is their only console/inspect/eval
  // route.
  {re: /(^|\/)chrome_url_overrides\/newtab\.js$/i, context: 'newtab'},
  {re: /(^|\/)chrome_url_overrides\/history\.js$/i, context: 'history'},
  {re: /(^|\/)chrome_url_overrides\/bookmarks\.js$/i, context: 'bookmarks'}
]

export class InjectBridgeRelay {
  apply(compiler: Compiler) {
    const controlPort = parseInt(
      String(process.env.EXTENSION_CONTROL_PORT || ''),
      10
    )
    if (!Number.isFinite(controlPort) || controlPort < 1) return // bridge off

    // Pre-bake one source per context (cheap; reused across matching assets).
    const sourceFor = new Map<string, string>()
    for (const t of RELAY_TARGETS) {
      if (!sourceFor.has(t.context)) {
        sourceFor.set(t.context, buildBridgeRelaySource({context: t.context}))
      }
    }

    compiler.hooks.thisCompilation.tap(
      InjectBridgeRelay.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: InjectBridgeRelay.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 101
          },
          () => {
            for (const asset of compilation.getAssets()) {
              const target = RELAY_TARGETS.find((t) => t.re.test(asset.name))
              if (!target) continue
              const original = asset.source.source().toString()
              if (original.indexOf('__extjsBridgeRelayInstalled') !== -1) {
                continue
              }
              const next = `${sourceFor.get(target.context)}\n${original}`
              compilation.updateAsset(asset.name, new sources.RawSource(next))
            }
          }
        )
      }
    )
  }
}
