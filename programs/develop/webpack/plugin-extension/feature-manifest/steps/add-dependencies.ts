import * as fs from 'fs'
import {type Compiler} from '@rspack/core'

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
      }
    )
  }
}
