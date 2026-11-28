// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Compiler, Configuration} from '@rspack/core'
import {removeOutputFile} from '../lib/remove-output-file'

interface SessionGoneOutputsOptions {
  isRestart: boolean
  distPath: string
  // The files this session's compilers wrote, shared by every one of them.
  written: Set<string>
}

// A restart compiles a new entry set and reloads the extension, so what the
// earlier compilers wrote and this one does not belongs to an entry that is
// gone. Only names this session wrote are removed, never a file it found.
class PruneGoneEntryOutputs {
  public static readonly name: string = 'dev-server:prune-gone-entry-outputs'

  private readonly isRestart: boolean
  private readonly distPath: string
  private readonly written: Set<string>

  constructor(options: SessionGoneOutputsOptions) {
    this.isRestart = options.isRestart
    this.distPath = options.distPath
    this.written = options.written
  }

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.done?.tap) return

    let settled = !this.isRestart

    compiler.hooks.done.tap(PruneGoneEntryOutputs.name, (stats) => {
      if (stats.compilation.errors.length > 0) return

      const outputPath = compiler.options.output?.path
      if (!outputPath) return

      const root = path.resolve(
        String(compiler.options.context || ''),
        outputPath
      )
      if (root !== path.resolve(this.distPath)) return

      const emitted = new Set<string>()
      const own: string[] = []

      for (const asset of stats.compilation.getAssets()) {
        const name = String(asset.name || '').replace(/\\/g, '/')

        emitted.add(name)
        // A copied file follows its source, which its own step looks after.
        if (!asset.info?.copied) own.push(name)
      }

      if (!settled) {
        settled = true

        for (const name of [...this.written]) {
          if (emitted.has(name)) continue

          removeOutputFile(root, name)
          this.written.delete(name)
        }
      }

      for (const name of own) this.written.add(name)
    })
  }
}

export function withGoneEntryOutputsPruned(
  config: Configuration,
  session: SessionGoneOutputsOptions
): Configuration {
  return {
    ...config,
    plugins: [new PruneGoneEntryOutputs(session), ...(config.plugins || [])]
  }
}
