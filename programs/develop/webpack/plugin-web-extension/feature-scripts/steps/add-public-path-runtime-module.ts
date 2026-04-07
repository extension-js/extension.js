// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

// This source file is adapted from
// https://github.com/awesome-webextension/webpack-target-webextension
// Released under the MIT License.

import {type Compiler} from '@rspack/core'

const basic = [
  `var isBrowser = !!(() => { try { return globalThis.browser.runtime.getURL("/") } catch(e) {} })()`,
  `var isChrome = !!(() => { try { return globalThis.chrome.runtime.getURL("/") } catch(e) {} })()`
]

const weakRuntimeCheck = [
  ...basic,
  // IMPORTANT: In MAIN world content scripts (and other non-extension pages),
  // extension APIs are not present. The runtime module must not throw during
  // initialization, because other generated runtime code may probe it eagerly.
  //
  // We intentionally avoid the upstream "throwing getter" here. When no runtime
  // is present we provide a minimal `{ runtime: { getURL } }` shim that returns
  // the input path unchanged, and the publicPath assignment below already guards
  // on `(isBrowser || isChrome)` before using `runtime.runtime.getURL(...)`.
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
