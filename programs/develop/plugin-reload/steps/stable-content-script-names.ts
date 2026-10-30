// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash} from 'node:crypto'
import {Compilation, type Compiler, sources} from '@rspack/core'

const HASHED_CONTENT_SCRIPT =
  /^content_scripts\/content-(\d+)\.([a-f0-9]+)\.js$/

// The hot runtime bakes the compilation hash into every chunk, so the bundler's
// content hash moves on any edit anywhere. A content script never runs a hot
// check, so that literal is left out of the hash its file name carries.
const FULL_HASH_LITERAL = /(__webpack_require__\.h = \(\) => \()"[^"]*"(\))/g

export function stableContentScriptHash(source: string, assetName: string) {
  const index = HASHED_CONTENT_SCRIPT.exec(assetName)?.[1] ?? ''
  const normalized = source
    .replace(FULL_HASH_LITERAL, '$1""$2')
    .split(assetName.slice(assetName.lastIndexOf('/') + 1))
    .join(`content-${index}.js`)

  return createHash('sha256').update(normalized).digest('hex').slice(0, 8)
}

// A static content script is read once at extension load, so a new file name
// forces a full extension reload; the name now changes only with the script.
export class StableContentScriptNames {
  apply(compiler: Compiler) {
    if (!compiler?.hooks?.thisCompilation) return

    compiler.hooks.thisCompilation.tap(
      StableContentScriptNames.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: StableContentScriptNames.name,
            // After source maps exist, before the manifest names the bundles
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE
          },
          () => {
            for (const asset of compilation.getAssets()) {
              const match = HASHED_CONTENT_SCRIPT.exec(asset.name)
              if (!match) continue

              const [, index, current] = match
              const source = asset.source.source().toString()
              const stable = stableContentScriptHash(source, asset.name)
              if (stable === current) continue

              const oldBase = `content-${index}.${current}.js`
              const newBase = `content-${index}.${stable}.js`
              const newName = `content_scripts/${newBase}`

              compilation.updateAsset(
                asset.name,
                new sources.RawSource(source.split(oldBase).join(newBase))
              )

              compilation.renameAsset(asset.name, newName)

              const map = compilation.getAsset(`${asset.name}.map`)
              if (!map) continue

              compilation.updateAsset(
                map.name,
                new sources.RawSource(
                  map.source.source().toString().split(oldBase).join(newBase)
                )
              )

              compilation.renameAsset(map.name, `${newName}.map`)
            }
          }
        )
      }
    )
  }
}
