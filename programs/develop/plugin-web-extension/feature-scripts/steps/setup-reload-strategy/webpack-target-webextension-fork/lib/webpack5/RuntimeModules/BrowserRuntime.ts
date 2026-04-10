import type * as webpack from 'webpack'

export const RuntimeGlobal = '__webpack_require__.webExtRt'
export const RuntimeGlobalIsBrowser = '__webpack_require__.webExtRtModern'

/**
 * @param webpack webpack instance
 * @param acceptWeak if accept weak runtime check
 */
export default function BrowserRuntimeModule(
  webpack: typeof import('webpack'),
  acceptWeak: boolean
): webpack.RuntimeModule {
  const {RuntimeModule, Template} = webpack
  class BrowserRuntime extends RuntimeModule {
    constructor() {
      super('WebExtensionBrowserRuntime', RuntimeModule.STAGE_NORMAL)
    }

    generate() {
      const {compilation} = this
      if (!compilation)
        return Template.asString(
          '/* [webpack-target-webextension] BrowserRuntimeModule skipped because no compilation is found. */'
        )

      const optionalChaining =
        compilation.outputOptions.environment.optionalChaining
      const _let = compilation.outputOptions.environment.const ? 'let' : 'var'
      return Template.asString(
        [
          `${_let} isChrome, runtime;`,
          'try {',
          Template.indent([
            `if (typeof globalThis === "object" && globalThis && typeof globalThis.browser !== "undefined" && ${
              optionalChaining
                ? 'typeof globalThis.browser.runtime?.getURL === "function"'
                : 'typeof globalThis.browser.runtime === "object" && typeof globalThis.browser.runtime.getURL === "function"'
            }) {`,
            Template.indent(['runtime = globalThis.browser;']),
            '}'
          ]),
          '} catch (_) {}',
          'if (!runtime) {',
          Template.indent([
            'try {',
            Template.indent([
              `if (typeof globalThis === "object" && globalThis && typeof globalThis.chrome !== "undefined" && ${
                optionalChaining
                  ? 'typeof globalThis.chrome.runtime?.getURL === "function"'
                  : 'typeof globalThis.chrome.runtime === "object" && typeof globalThis.chrome.runtime.getURL === "function"'
              }) {`,
              Template.indent([
                'isChrome = true;',
                'runtime = globalThis.chrome;'
              ]),
              '}'
            ]),
            '} catch (_) {}'
          ]),
          '}',
          `${RuntimeGlobalIsBrowser} = !isChrome;`,
          // IMPORTANT: In MAIN world content scripts, extension APIs are not present.
          // Do NOT create throwing getters here (other runtime modules probe early).
          `${RuntimeGlobal} = runtime || { runtime: null };`,
          acceptWeak
            ? `if (!runtime && (typeof self !== "object" || !self.addEventListener)) {`
            : '',
          acceptWeak
            ? Template.indent([
                `${RuntimeGlobal} = { runtime: { getURL: String } };`
              ])
            : '',
          acceptWeak ? '}' : ''
        ].filter(Boolean)
      )
    }
  }
  return new BrowserRuntime()
}
