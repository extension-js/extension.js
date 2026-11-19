// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {Compilation, type Compiler, sources, WebpackError} from '@rspack/core'
import {
  contentScriptRetainsDevServerRuntime,
  stripDevServerStartup
} from './remove-content-script-dev-server-runtime'

const CONTENT_SCRIPT_ASSET =
  /(^|\/)content_scripts\/content-\d+(?:\.[a-f0-9]+)?\.js$/i

// The devtool wrote the map before this stage, so the map is cut with the
// bundle, or every line below a removed one maps one line off.
function withoutRemoved(
  compilation: Compilation,
  name: string,
  original: string,
  removed: Array<[number, number]>
) {
  const mapAsset = compilation.getAsset(`${name}.map`)
  let map: Record<string, unknown> | undefined

  try {
    map = mapAsset
      ? (JSON.parse(mapAsset.source.source().toString()) as Record<
          string,
          unknown
        >)
      : undefined
  } catch {
    // A map the devtool did not write as JSON is left alone.
  }

  const cut = new sources.ReplaceSource(
    map
      ? new sources.SourceMapSource(original, name, map as never)
      : new sources.RawSource(original)
  )

  for (const [start, end] of removed) cut.replace(start, end - 1, '')

  const result = cut.sourceAndMap()
  compilation.updateAsset(name, new sources.RawSource(String(result.source)))

  if (map && result.map) {
    compilation.updateAsset(
      `${name}.map`,
      new sources.RawSource(JSON.stringify({...map, ...result.map}))
    )
  }
}

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
              const stripped = stripDevServerStartup(originalSource)

              if (stripped.removed.length > 0) {
                withoutRemoved(
                  compilation,
                  asset.name,
                  originalSource,
                  stripped.removed
                )
              }

              if (contentScriptRetainsDevServerRuntime(stripped.source)) {
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
