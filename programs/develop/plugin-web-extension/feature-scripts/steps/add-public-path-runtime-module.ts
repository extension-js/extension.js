// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

// Adapted from https://github.com/awesome-webextension/webpack-target-webextension
// Released under the MIT License.

import type {Compiler} from '@rspack/core'

const basic = [
  `var isBrowser = !!(() => { try { return globalThis.browser.runtime.getURL("/") } catch(e) {
    // Ignore
  } })()`,
  `var isChrome = !!(() => { try { return globalThis.chrome.runtime.getURL("/") } catch(e) {
    // Ignore
  } })()`
]

const weakRuntimeCheck = [
  ...basic,
  // In MAIN world content scripts extension APIs are absent; must not throw at
  // init. A minimal getURL shim replaces the upstream "throwing getter".
  `var runtime = isBrowser ? globalThis.browser : isChrome ? globalThis.chrome : { runtime: { getURL: x => x } }`
]

export class AddPublicPathRuntimeModule {
  apply(compiler: Compiler) {
    const {RuntimeGlobals} = compiler.webpack

    compiler.hooks.compilation.tap('PublicPathRuntimeModule', (compilation) => {
      compilation.hooks.runtimeRequirementInTree
        .for(RuntimeGlobals.publicPath)
        .tap(AddPublicPathRuntimeModule.name, (chunk) => {
          const module = PublicPathRuntimeModule(compiler)

          compilation.addRuntimeModule(chunk, module)

          return true
        })
    })
  }
}

function PublicPathRuntimeModule(compiler: Compiler) {
  const {Template, RuntimeModule, RuntimeGlobals} = compiler.webpack
  class PublicPathRuntimeModule extends RuntimeModule {
    constructor() {
      super('publicPath', RuntimeModule.STAGE_BASIC)
    }

    generate() {
      const publicPath = this.compilation?.outputOptions.publicPath

      return Template.asString([
        ...weakRuntimeCheck,
        `var __extjsBase = (typeof globalThis === "object" && globalThis && globalThis.__EXTJS_EXTENSION_BASE__) ? String(globalThis.__EXTJS_EXTENSION_BASE__) : "";`,
        `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
        Template.indent([
          `try { __extjsBase = document.documentElement.getAttribute("data-extjs-extension-base") || ""; } catch(_) { __extjsBase = ""; }`
        ]),
        `}`,
        `var path = ${JSON.stringify(
          this.compilation?.getPath((publicPath as string) || '', {
            hash: this.compilation.hash || 'XXXX'
          })
        )}`,
        `var __extjsRuntimePath = "";`,
        `if (!(typeof importScripts === 'function') && (isBrowser || isChrome)) {`,
        Template.indent([
          `try { __extjsRuntimePath = runtime.runtime.getURL(path); } catch (_) { __extjsRuntimePath = ""; }`
        ]),
        `}`,
        `${RuntimeGlobals.publicPath} = typeof importScripts === 'function' || !(isBrowser || isChrome) ? path : (__extjsRuntimePath || (__extjsBase ? __extjsBase.replace(/\\/+$/, "/") + String(path).replace(/^\\/+/, "") : ""));`
      ])
    }
  }

  return new PublicPathRuntimeModule()
}
