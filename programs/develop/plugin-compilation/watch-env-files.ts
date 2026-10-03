//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, type Compiler, WebpackError} from '@rspack/core'
import {requestDevSessionRestart} from '../dev-server/session-restart'
import * as messages from './compilation-lib/messages'

// The env files are read once, when the plugin is applied, and their values go
// into a DefinePlugin that the bundler freezes at that moment. A new value
// therefore needs a new compiler, which is what a session restart builds.
export class WatchEnvFilesPlugin {
  public static readonly name: string = 'plugin-compilation:watch-env-files'

  private readonly candidates: string[]
  private readonly watched: Set<string>
  private changedPath: string | null = null

  constructor(paths: Array<string | undefined>) {
    this.candidates = Array.from(
      new Set(
        paths
          .filter((file): file is string => Boolean(file))
          .map((file) => path.resolve(file))
      )
    )

    this.watched = new Set(this.candidates)
  }

  private collectChange(compiler: Compiler): void {
    const touched = [
      ...(compiler.modifiedFiles || []),
      ...(compiler.removedFiles || [])
    ]

    for (const file of touched) {
      const resolved = path.resolve(file)

      if (this.watched.has(resolved)) {
        this.changedPath = resolved

        return
      }
    }
  }

  private addDependencies(compilation: Compilation): void {
    for (const candidate of this.candidates) {
      // A candidate that is not there yet is a missing dependency, so writing
      // a better-matching env file mid-session counts as a change too.
      if (fs.existsSync(candidate)) compilation.fileDependencies?.add(candidate)
      else compilation.missingDependencies?.add(candidate)
    }
  }

  public apply(compiler: Compiler): void {
    if (this.candidates.length === 0) return

    compiler.hooks.watchRun.tap(WatchEnvFilesPlugin.name, () => {
      this.collectChange(compiler)
    })

    compiler.hooks.thisCompilation.tap(
      WatchEnvFilesPlugin.name,
      (compilation: Compilation) => {
        this.addDependencies(compilation)

        const changedPath = this.changedPath
        if (!changedPath) return

        this.changedPath = null

        // A live session rebuilds itself from the new values. Without one the
        // caller owns the restart, so the build has to say what went stale.
        if (
          requestDevSessionRestart(compiler, {
            reason: 'env',
            pathChanged: changedPath
          })
        ) {
          return
        }

        const warning = new WebpackError(
          messages.envChangedRestartRequired(changedPath)
        ) as Error & {name?: string; file?: string}
        warning.name = 'EnvFileChange'
        warning.file = path.basename(changedPath)
        compilation.warnings?.push(warning)
      }
    )
  }
}
