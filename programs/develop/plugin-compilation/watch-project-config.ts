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
import {projectConfigCandidatePaths} from '../lib/config-loader'
import * as messages from './compilation-lib/messages'

// A dev session reads extension.config.js once, and both the config loader and
// Node's module registry cache it, so no later compile can see a new value.
// Watching the file is what turns an ignored edit into something said out loud.

// What each candidate held when the session first looked, null when absent.
// It outlives a compiler, so the session's own restart still knows it is stale.
const sessionSnapshot = new Map<string, string | null>()

function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export class WatchProjectConfigPlugin {
  public static readonly name: string =
    'plugin-compilation:watch-project-config'

  private readonly projectPath: string
  private readonly candidates: string[]
  private readonly watched: Set<string>
  private changedPath: string | null = null

  constructor(projectPath: string) {
    this.projectPath = projectPath
    this.candidates = projectPath
      ? projectConfigCandidatePaths(projectPath).map((file) =>
          path.resolve(file)
        )
      : []

    this.watched = new Set(this.candidates)

    for (const candidate of this.candidates) {
      if (!sessionSnapshot.has(candidate)) {
        sessionSnapshot.set(candidate, readOrNull(candidate))
      }
    }

    // A compiler built by a restart starts out stale when the file moved on.
    this.changedPath =
      this.candidates.find((candidate) => this.drifted(candidate)) || null
  }

  // A save that leaves the bytes alone is not a change the session missed.
  private drifted(file: string): boolean {
    return readOrNull(file) !== sessionSnapshot.get(file)
  }

  private collectChange(compiler: Compiler): void {
    const touched = [
      ...(compiler.modifiedFiles || []),
      ...(compiler.removedFiles || [])
    ]

    for (const file of touched) {
      const resolved = path.resolve(file)

      if (this.watched.has(resolved) && this.drifted(resolved)) {
        this.changedPath = resolved

        return
      }
    }
  }

  private addDependencies(compilation: Compilation): void {
    for (const candidate of this.candidates) {
      // A file that is not there yet is a missing dependency, which is how a
      // config added after the session started becomes a change.
      if (fs.existsSync(candidate)) compilation.fileDependencies?.add(candidate)
      else compilation.missingDependencies?.add(candidate)
    }
  }

  public apply(compiler: Compiler): void {
    if (this.candidates.length === 0) return

    compiler.hooks.watchRun.tap(WatchProjectConfigPlugin.name, () => {
      this.collectChange(compiler)
    })

    compiler.hooks.thisCompilation.tap(
      WatchProjectConfigPlugin.name,
      (compilation: Compilation) => {
        this.addDependencies(compilation)

        const changedPath = this.changedPath
        if (!changedPath) return

        // Said once per save, not once per compile: the author who edits a
        // source file next is not editing the config again.
        this.changedPath = null
        const warning = new WebpackError(
          messages.projectConfigChangedRestartRequired(changedPath)
        ) as Error & {name?: string; file?: string}
        warning.name = 'ProjectConfigChange'
        warning.file = path.relative(this.projectPath, changedPath)
        compilation.warnings?.push(warning)
      }
    )
  }
}
