import fs from 'fs'
import type webpack from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'

export default class AddDependenciesPlugin {
  public readonly manifestPath: string

  constructor(options: {manifestPath: string}) {
    this.manifestPath = options.manifestPath
  }

  apply(compiler: webpack.Compiler): void {
    compiler.hooks.afterCompile.tap(
      'RunChromeExtensionPlugin',
      (compilation) => {
        if (compilation.errors?.length) return

        const manifestFilePath = this.manifestPath
        const manifestHtml = manifestFields(manifestFilePath).html
        const manifestJson = manifestFields(manifestFilePath).json
        const manifestLocale = manifestFields(manifestFilePath).locales
        const manifestScripts = manifestFields(manifestFilePath).scripts

        const allEntries = [
          ...Object.values(manifestHtml),
          ...Object.values(manifestJson),
          ...Object.values(manifestScripts),
          ...Object.values(manifestLocale),
          ...Object.values(manifestScripts)
        ]

        const fileDependencies = new Set(compilation.fileDependencies)

        if (allEntries) {
          allEntries.forEach((dependency) => {
            const dependencyArray = Array.isArray(dependency)
              ? dependency
              : [dependency]

            dependencyArray.forEach((dependency) => {
              if (typeof dependency === 'string') {
                if (!dependency) return
                if (!fs.existsSync(dependency)) return

                if (!fileDependencies.has(dependency)) {
                  fileDependencies.add(dependency)
                  compilation.fileDependencies.add(dependency)
                }
              } else {
                if (!dependency) return
                const htmlAssetsList = Object.entries(dependency)

                for (const [, htmldependency] of htmlAssetsList) {
                  const htmldependencyArray = Array.isArray(htmldependency)
                    ? htmldependency
                    : [htmldependency]

                  htmldependencyArray.forEach((htmlDependency) => {
                    if (!htmlDependency) return
                    if (!fs.existsSync(htmlDependency)) return
                    if (!fileDependencies.has(htmlDependency)) {
                      fileDependencies.add(htmlDependency)
                      compilation.fileDependencies.add(htmlDependency)
                    }
                  })
                }
              }
            })
          })
        }
      }
    )
  }
}
