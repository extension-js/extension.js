// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler, Configuration} from '@rspack/core'
import {detectLiveDevSessionOwner} from '../plugin-playwright'

export interface SessionStartPruneOptions {
  isRestart: boolean
  distPath: string
  readyPath: string
}

function removeLeftovers(folder: string, root: string, emitted: Set<string>) {
  for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
    const absolute = path.join(folder, entry.name)

    if (entry.isDirectory()) {
      removeLeftovers(absolute, root, emitted)

      try {
        if (fs.readdirSync(absolute).length === 0) fs.rmdirSync(absolute)
      } catch {
        // Ignore
      }

      continue
    }

    const name = path.relative(root, absolute).replace(/\\/g, '/')
    if (emitted.has(name)) continue

    try {
      fs.rmSync(absolute, {force: true})
    } catch {
      // Ignore
    }
  }
}

// A running session never cleans its output: a tab opened before a rebuild
// still reads older hashed chunks. Before the first good compile no such tab
// exists, so what an earlier session left behind goes then, and only then.
export class PruneSessionStartLeftovers {
  public static readonly name: string = 'dev-server:prune-session-start'

  private readonly distPath: string

  constructor(distPath: string) {
    this.distPath = distPath
  }

  apply(compiler: Compiler) {
    let pruned = false

    compiler.hooks.done.tap(PruneSessionStartLeftovers.name, (stats) => {
      if (pruned || stats.compilation.errors.length > 0) return

      const outputPath = compiler.options.output?.path
      if (!outputPath) return

      const root = path.resolve(
        String(compiler.options.context || ''),
        outputPath
      )
      if (root !== path.resolve(this.distPath)) return

      pruned = true
      const emitted = new Set<string>()

      for (const asset of stats.compilation.getAssets()) {
        emitted.add(String(asset.name || '').replace(/\\/g, '/'))
      }

      try {
        removeLeftovers(root, root, emitted)
      } catch {
        // Ignore
      }
    })
  }
}

export function withSessionStartPrune(
  config: Configuration,
  session: SessionStartPruneOptions
): Configuration {
  if (session.isRestart) return config

  // Another live session on this target has tabs that read these files.
  if (detectLiveDevSessionOwner(session.readyPath)) return config

  return {
    ...config,
    plugins: [
      new PruneSessionStartLeftovers(session.distPath),
      ...(config.plugins || [])
    ]
  }
}
