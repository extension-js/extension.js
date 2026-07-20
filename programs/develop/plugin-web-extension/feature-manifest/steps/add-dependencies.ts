// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'
import * as messages from '../messages'

export class AddDependencies {
  private readonly dependencyList: string[]

  constructor(dependencyList: string[]) {
    this.dependencyList = dependencyList
  }

  apply(compiler: Compiler): void {
    compiler.hooks.afterCompile.tap(
      'manifest:add-dependency',
      (compilation) => {
        // Register even when the compile errored: the watcher only watches the
        // LAST compilation's fileDependencies, so skipping here would unwatch
        // the manifest for the rest of the session and a manifest fix could
        // never trigger the recompile that clears the error (§66).
        const deps = compilation.fileDependencies

        if (this.dependencyList) {
          this.dependencyList.forEach((dependency) => {
            const alreadyPresent =
              typeof deps?.has === 'function' ? deps.has(dependency) : false

            if (!alreadyPresent && typeof deps?.add === 'function') {
              deps.add(dependency)
            }
          })
        }

        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          const added = Array.isArray(this.dependencyList)
            ? this.dependencyList.length
            : 0
          // Lazy import path from steps/ -> parent dir
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          console.log(messages.manifestDepsTracked(added))
        }
      }
    )
  }
}
