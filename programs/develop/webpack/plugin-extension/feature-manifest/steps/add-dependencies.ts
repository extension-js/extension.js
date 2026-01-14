// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
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
        if (compilation.errors?.length) return

        const deps = compilation.fileDependencies

        if (this.dependencyList) {
          this.dependencyList.forEach((dependency) => {
            const alreadyPresent =
              typeof deps?.has === 'function' ? deps.has(dependency) : false

            if (!alreadyPresent) {
              if (typeof deps?.add === 'function') deps.add(dependency)

              // Fallback for implementations that expect mutation via original reference
              if (
                deps !== compilation.fileDependencies &&
                typeof compilation.fileDependencies?.add === 'function'
              ) {
                compilation.fileDependencies.add(dependency)
              }
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
