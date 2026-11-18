// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation, Compiler} from '@rspack/core'

// Where a package named by a bare request lands when it is installed.
export function installedPackageDir(
  projectRoot: string,
  request: string
): string {
  const segments = request.split('/')
  const name = request.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0]

  return path.join(projectRoot, 'node_modules', name)
}

// A reference left verbatim for a missing target is watched by nothing, so
// this rebuilds the file that made it once the target is there.
export class MissingReferenceWatch {
  public static readonly name: string = 'missing-reference-watch'

  // Missing target, and the files whose reference to it was left verbatim.
  private readonly waiting = new Map<string, Set<string>>()

  record(target: string, issuer: string | undefined): void {
    if (!issuer || !path.isAbsolute(issuer)) return

    const issuers = this.waiting.get(target) ?? new Set<string>()

    issuers.add(issuer)
    this.waiting.set(target, issuers)
  }

  private forget(issuer: string): void {
    for (const [target, issuers] of this.waiting) {
      issuers.delete(issuer)
      if (issuers.size === 0) this.waiting.delete(target)
    }
  }

  apply(compiler: Compiler): void {
    compiler.hooks.watchRun.tap(MissingReferenceWatch.name, () => {
      const modified = new Set(compiler.modifiedFiles)

      for (const [target, issuers] of this.waiting) {
        if (!fs.existsSync(target)) continue

        // The bundler only resolves a reference again when it rebuilds the
        // file that makes it, so that file is reported as changed.
        for (const issuer of issuers) modified.add(issuer)
      }

      // A file about to be rebuilt records again what it still misses.
      for (const file of modified) this.forget(file)
      for (const file of compiler.removedFiles ?? []) this.forget(file)

      if (modified.size > (compiler.modifiedFiles?.size ?? 0)) {
        compiler.modifiedFiles = modified
      }
    })

    compiler.hooks.afterCompile.tap(
      MissingReferenceWatch.name,
      (compilation: Compilation) => {
        for (const target of this.waiting.keys()) {
          compilation.missingDependencies.add(target)
        }
      }
    )
  }
}
