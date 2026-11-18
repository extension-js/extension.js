// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler, RuntimeModule} from '@rspack/core'

// Derived from webpack-target-webextension (MIT, Copyright 2020 CRIMX).
// The license notice is in the README of this folder.

export const RuntimeGlobal = '__webpack_require__.webExtRt'
export const RuntimeGlobalIsBrowser = '__webpack_require__.webExtRtModern'

// The extension API of the world a bundle runs in, under one runtime global.
export function BrowserRuntimeModule(
  webpack: Compiler['webpack'],
  acceptWeak: boolean
): RuntimeModule {
  const {RuntimeModule, Template} = webpack

  class BrowserRuntime extends RuntimeModule {
    constructor() {
      super('WebExtensionBrowserRuntime', RuntimeModule.STAGE_NORMAL)
    }

    generate(): string {
      const {compilation} = this

      if (!compilation) {
        return Template.asString(
          '/* [webpack-target-webextension] BrowserRuntimeModule skipped because no compilation is found. */'
        )
      }

      const optionalChaining =
        compilation.outputOptions.environment?.optionalChaining
      const _let = compilation.outputOptions.environment?.const ? 'let' : 'var'

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
          // A MAIN world content script has no extension API, and the other
          // runtime modules probe this early, so no getter here may throw.
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
