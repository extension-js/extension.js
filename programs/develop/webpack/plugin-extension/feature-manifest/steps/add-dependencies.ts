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

        const fileDependencies = new Set(compilation.fileDependencies)

        if (this.dependencyList) {
          this.dependencyList.forEach((dependency) => {
            if (!fs.existsSync(dependency)) return

            if (!fileDependencies.has(dependency)) {
              fileDependencies.add(dependency)
              compilation.fileDependencies.add(dependency)
            }
          })
        }
      }
    )
  }
}
