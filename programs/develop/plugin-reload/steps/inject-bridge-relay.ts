// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler} from '@rspack/core'
import type {LogContext} from '../../dev-server/control-bridge/contracts'
import {buildBridgeRelaySource} from '../../dev-server/control-bridge/producer-runtime'
import {prependToEmittedAsset} from '../../lib/asset-source-maps'
import type {DevSessionCoordinates} from '../../lib/dev-session-coordinates'
import {buildDeclaredSheetSignalSource} from '../reload-lib/producer-reload'
import {BRIDGE_STAGE_AFTER_REPORT} from './stages'

// Map an output asset to its bridge context. The background SW and hot/* are
// DELIBERATELY excluded: the SW runs the producer, relay-injecting would loop.
export const RELAY_TARGETS: ReadonlyArray<{
  re: RegExp
  context: LogContext
}> = [
  {re: /^content_scripts\/.+\.js$/i, context: 'content'},
  {re: /^action\/index\.js$/i, context: 'popup'},
  {re: /^options\/index\.js$/i, context: 'options'},
  {re: /^sidebar\/index\.js$/i, context: 'sidebar'},
  {re: /^devtools\/index\.js$/i, context: 'devtools'},
  // chrome_url_overrides pages are extension pages tab-targeted chrome.scripting
  // can never reach; the relay is their only console/inspect/eval route.
  {re: /^chrome_url_overrides\/newtab\.js$/i, context: 'newtab'},
  {re: /^chrome_url_overrides\/history\.js$/i, context: 'history'},
  {re: /^chrome_url_overrides\/bookmarks\.js$/i, context: 'bookmarks'}
]

export class InjectBridgeRelay {
  private readonly controlPort?: number | null

  constructor(session?: Pick<DevSessionCoordinates, 'controlPort'>) {
    this.controlPort = session?.controlPort
  }

  apply(compiler: Compiler) {
    // Only the session's own port turns the relay on.
    const controlPort = Number(this.controlPort ?? Number.NaN)
    if (!Number.isFinite(controlPort) || controlPort < 1) return

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
            stage:
              Compilation.PROCESS_ASSETS_STAGE_REPORT +
              BRIDGE_STAGE_AFTER_REPORT
          },
          () => {
            for (const asset of compilation.getAssets()) {
              const target = RELAY_TARGETS.find((t) => t.re.test(asset.name))
              if (!target) continue

              const original = asset.source.source().toString()

              if (original.indexOf('__extjsBridgeRelayInstalled') !== -1) {
                continue
              }

              // A content script bundle also names itself to its frame, so
              // the background can tell which declared entries run there.
              const sheetSignal =
                target.context === 'content'
                  ? buildDeclaredSheetSignalSource(asset.name)
                  : ''

              prependToEmittedAsset(
                compilation,
                asset,
                `${sheetSignal}${sourceFor.get(target.context)}\n`
              )
            }
          }
        )
      }
    )
  }
}
