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

const HOT_DIR = 'hot'

// Prune superseded hot-update generations from hot/: only the current one is
// requested, and the previous is kept one round for in-flight fetches.
export class PruneStaleHotUpdates {
  public static readonly name = 'plugin-reload:prune-stale-hot-updates'

  private previousGeneration = new Set<string>()

  public apply(compiler: Compiler): void {
    if (!compiler?.hooks?.done?.tap) return
    compiler.hooks.done.tap(PruneStaleHotUpdates.name, (stats) => {
      try {
        const outputPath = compiler.options.output?.path
        if (!outputPath) return

        const hotDir = path.join(outputPath, HOT_DIR)
        if (!fs.existsSync(hotDir)) return

        const emitted = new Set<string>()
        for (const asset of stats.compilation.getAssets()) {
          const name = String(asset.name || '').replace(/\\/g, '/')
          if (name.startsWith(`${HOT_DIR}/`)) {
            emitted.add(name.slice(HOT_DIR.length + 1))
          }
        }

        const keep = new Set([...emitted, ...this.previousGeneration])
        // Hot assets nest by runtime name, so walk recursively and compare
        // hot-relative posix paths.
        const pruneDir = (dir: string, relPrefix: string) => {
          for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
            const absolute = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              pruneDir(absolute, rel)
              try {
                if (fs.readdirSync(absolute).length === 0) {
                  fs.rmdirSync(absolute)
                }
              } catch {
                // Ignore
              }
              continue
            }
            if (keep.has(rel)) continue
            try {
              fs.rmSync(absolute, {force: true})
            } catch {
              // Ignore
            }
          }
        }
        pruneDir(hotDir, '')

        this.previousGeneration = emitted
      } catch {
        // pruning must never fail a compile
      }
    })
  }
}
