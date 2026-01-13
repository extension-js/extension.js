import type * as webpack from 'webpack'
import {RuntimeGlobal} from './BrowserRuntime'

export default function PublicPathRuntimeModule(
  webpack: typeof import('webpack')
): webpack.RuntimeModule {
  const {RuntimeGlobals, RuntimeModule, Template} = webpack

  class PublicPathRuntime extends RuntimeModule {
    constructor() {
      super('publicPath', RuntimeModule.STAGE_BASIC)
    }

    generate() {
      const {compilation} = this
      if (!compilation)
        return Template.asString(
          '/* [webpack-target-webextension] PublicPathRuntimeModule skipped because no compilation is found. */'
        )
      const {publicPath} = compilation.outputOptions

      const path = JSON.stringify(
        compilation.getPath(publicPath || '', {
          hash: compilation.hash || 'XXXX'
        })
      )
      return Template.asString([
        // When extension runtime exists, use runtime.getURL().
        // In MAIN world content scripts, runtime is missing; fall back to empty publicPath
        // and rely on the bridge loader to resolve/inject chunks.
        `if (${RuntimeGlobal} && ${RuntimeGlobal}.runtime && typeof ${RuntimeGlobal}.runtime.getURL === "function") {`,
        Template.indent([
          `${RuntimeGlobals.publicPath} = ${RuntimeGlobal}.runtime.getURL(${path});`
        ]),
        `} else {`,
        Template.indent([`${RuntimeGlobals.publicPath} = "";`]),
        `}`
      ])
    }
  }

  return new PublicPathRuntime()
}
