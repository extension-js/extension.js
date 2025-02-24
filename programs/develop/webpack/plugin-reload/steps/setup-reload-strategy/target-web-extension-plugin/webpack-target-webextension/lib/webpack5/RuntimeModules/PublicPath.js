// @ts-check
const BrowserRuntime = require('./BrowserRuntime.js')

/**
 * @param {import('webpack')} webpack
 * @returns {import('webpack').RuntimeModule}
 */
module.exports = function PublicPathRuntimeModule(webpack) {
  const { RuntimeGlobals, RuntimeModule, Template } = webpack

  class PublicPathRuntimeModule extends RuntimeModule {
    constructor() {
      super('publicPath', RuntimeModule.STAGE_BASIC)
    }
    /**
     * @returns {string} runtime code
     */
    generate() {
      const { compilation } = this
      if (!compilation)
        return Template.asString(
          '/* [webpack-target-webextension] PublicPathRuntimeModule skipped because no compilation is found. */',
        )
      const { publicPath } = compilation.outputOptions

      const path = JSON.stringify(
        compilation.getPath(publicPath || '', {
          hash: compilation.hash || 'XXXX',
        }),
      )
      return Template.asString([
        `if (${BrowserRuntime.RuntimeGlobal}) {`,
        Template.indent([`${RuntimeGlobals.publicPath} = ${BrowserRuntime.RuntimeGlobal}.runtime.getURL(${path});`]),
        '}',
      ])
    }
  }

  return new PublicPathRuntimeModule()
}
