/**
 * @param {import('webpack')} webpack
 * @param {boolean} acceptWeak if accept weak runtime check
 * @returns {import('webpack').RuntimeModule}
 */
module.exports = function BrowserRuntimeModule(webpack, acceptWeak) {
  const { RuntimeModule, Template } = webpack
  class BrowserRuntimeModule extends RuntimeModule {
    constructor() {
      super('WebExtensionBrowserRuntime', RuntimeModule.STAGE_NORMAL)
    }

    /**
     * @returns {string} runtime code
     */
    generate() {
      const { compilation } = this
      if (!compilation)
        return Template.asString(
          '/* [webpack-target-webextension] BrowserRuntimeModule skipped because no compilation is found. */',
        )

      const optionalChaining = compilation.outputOptions.environment.optionalChaining
      const _let = compilation.outputOptions.environment.const ? 'let' : 'var'
      return Template.asString(
        [
          `${_let} isChrome, runtime;`,
          'try {',
          Template.indent([
            `if (typeof browser !== "undefined" && ${
              optionalChaining
                ? 'typeof browser.runtime?.getURL === "function"'
                : 'typeof browser.runtime === "object" && typeof browser.runtime.getURL === "function"'
            }) {`,
            Template.indent(['runtime = browser;']),
            '}',
          ]),
          '} catch (_) {}',
          'if (!runtime) {',
          Template.indent([
            'try {',
            Template.indent([
              `if (typeof chrome !== "undefined" && ${
                optionalChaining
                  ? 'typeof chrome.runtime?.getURL === "function"'
                  : 'typeof chrome.runtime === "object" && typeof chrome.runtime.getURL === "function"'
              }) {`,
              Template.indent(['isChrome = true;', 'runtime = chrome;']),
              '}',
            ]),
            '} catch (_) {}',
          ]),
          '}',
          `${module.exports.RuntimeGlobalIsBrowser} = !isChrome;`,
          `${module.exports.RuntimeGlobal} = runtime || {`,
          Template.indent([
            'get runtime() {',
            Template.indent('throw new Error("No chrome or browser runtime found");'),
            '}',
          ]),
          '}',
          acceptWeak ? `if (!runtime && (typeof self !== "object" || !self.addEventListener)) {` : '',
          acceptWeak ? Template.indent([`${module.exports.RuntimeGlobal} = { runtime: { getURL: String } };`]) : '',
          acceptWeak ? '}' : '',
        ].filter(Boolean),
      )
    }
  }
  return new BrowserRuntimeModule()
}
module.exports.RuntimeGlobal = '__webpack_require__.webExtRt'
module.exports.RuntimeGlobalIsBrowser = '__webpack_require__.webExtRtModern'
