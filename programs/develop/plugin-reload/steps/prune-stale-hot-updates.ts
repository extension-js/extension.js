// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Compiler} from '@rspack/core'
import * as fs from 'fs'
import * as path from 'path'

const HOT_DIR = 'hot'

/**
 * Prune superseded hot-update generations from `dist/<browser>/hot/`.
 *
 * The HMR runtime resolves hot chunks against the extension origin
 * (publicPath = chrome-extension://<id>/), so the files under hot/ are
 * fetched FROM DISK and must ship in the loadable dist — but only the
 * current generation is ever requested (currentHash -> nextHash). Without
 * pruning, every edit leaves its .js/.json/.map generation behind forever:
 * an afternoon of editing puts hundreds of stale files in the "what ships"
 * tree, all churning fs watchers on each edit.
 *
 * The previous generation is kept one round as a grace window for an
 * in-flight fetch racing the compile that superseded it.
 */
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
        // Hot assets nest by runtime name (hot/background/service_worker.<hash>.json,
        // hot/content_scripts/content-N.<hash>.json), so walk recursively and
        // compare hot-relative posix paths.
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
                // best-effort only
              }
              continue
            }
            if (keep.has(rel)) continue
            try {
              fs.rmSync(absolute, {force: true})
            } catch {
              // best-effort only
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
