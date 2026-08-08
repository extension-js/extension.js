// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {humanLine} from '../../../dev-server/lifecycle-stream'
import {isDebug} from '../../../lib/messaging'
import {parseJsonSafe} from '../../../lib/parse-json-safe'
import {findLegacyManifestPathHits} from '../manifest-lib/legacy-paths'
import {getOriginalManifestContent} from '../manifest-lib/manifest'
import * as messages from '../messages'

export class ManifestLegacyWarnings {
  public static readonly name: string = 'manifest:legacy-warnings'
  // Dev recompiles re-scan the same author fields on every save. One human line
  // per distinct field hit for the life of this plugin (one `extension dev`
  // process) is enough; a restarted session gets a fresh instance. Production
  // builds never consult this set so a single build always surfaces every hit.
  private reportedHits = new Set<string>()

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      ManifestLegacyWarnings.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: ManifestLegacyWarnings.name,
            // After UpdateManifest rewrites the asset to modern paths; we read
            // the author source stored by EmitManifest, not the rewritten asset.
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            const original = getOriginalManifestContent(compilation)
            if (!original) return

            const manifest = parseJsonSafe(original)
            const hits = findLegacyManifestPathHits(manifest)
            if (hits.length === 0) return

            const isDev = compiler.options.mode === 'development'
            let printed = 0

            for (const hit of hits) {
              const signature = `${hit.field}\0${hit.legacyPath}`
              if (isDev) {
                if (this.reportedHits.has(signature)) continue
                this.reportedHits.add(signature)
              }

              const message = messages.legacyManifestPathWarning(
                hit.field,
                hit.legacyPath,
                hit.modernPath
              )
              // Human line at emit time; stats/json keep the record and the
              // stats render skips ManifestLegacyWarning to avoid a double print.
              humanLine(message)
              const warn = new WebpackError(message) as Error & {
                file?: string
                name?: string
              }
              warn.name = 'ManifestLegacyWarning'
              warn.file = 'manifest.json'
              compilation.warnings.push(warn)
              printed++
            }

            if (isDebug()) {
              console.log(messages.manifestLegacyWarningsSummary(printed))
            }
          }
        )
      }
    )
  }
}
