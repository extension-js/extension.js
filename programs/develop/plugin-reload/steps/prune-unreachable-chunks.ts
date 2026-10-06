// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'

// A lazy chunk takes the default [id].js name at the output root.
const LAZY_CHUNK_FILE = /^\d+\.js(?:\.map)?$/

// Dev never cleans its output, so the chunk an import() reached stays once
// the entry that reached it is edited away or removed. The compile that
// stops emitting it also reloads or re-injects that entry, so only an
// instance that reload already superseded could still ask for it.
export class PruneUnreachableChunks {
  public static readonly name = 'plugin-reload:prune-unreachable-chunks'

  public apply(compiler: Compiler): void {
    if (!compiler?.hooks?.done?.tap) return

    compiler.hooks.done.tap(PruneUnreachableChunks.name, (stats) => {
      try {
        const outputPath = compiler.options.output?.path
        if (!outputPath || stats.compilation.errors.length > 0) return

        const emitted = new Set(
          stats.compilation
            .getAssets()
            .map((asset) => String(asset.name || '').replace(/\\/g, '/'))
        )

        for (const name of fs.readdirSync(outputPath)) {
          if (!LAZY_CHUNK_FILE.test(name) || emitted.has(name)) continue

          try {
            fs.rmSync(path.join(outputPath, name), {force: true})
          } catch {
            // Ignore
          }
        }
      } catch {
        // pruning must never fail a compile
      }
    })
  }
}
