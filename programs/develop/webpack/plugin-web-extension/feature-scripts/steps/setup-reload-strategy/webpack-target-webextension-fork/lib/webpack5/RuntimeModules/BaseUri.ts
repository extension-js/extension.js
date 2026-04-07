import type * as webpack from 'webpack'
import {RuntimeGlobal} from './BrowserRuntime'

export default function BaseUriRuntimeModule(
  webpack: typeof import('webpack')
): webpack.RuntimeModule {
  const {RuntimeGlobals, RuntimeModule, Template} = webpack

  class BaseUriRuntime extends RuntimeModule {
    constructor() {
      super('baseURI', RuntimeModule.STAGE_BASIC)
    }

    generate() {
      return Template.asString([
        `var __extjsBase = "";`,
        `try {`,
        Template.indent([
          `if (${RuntimeGlobal} && ${RuntimeGlobal}.runtime && typeof ${RuntimeGlobal}.runtime.getURL === "function") {`,
          Template.indent([
            `__extjsBase = String(${RuntimeGlobal}.runtime.getURL("/"));`
          ]),
          `}`
        ]),
        `} catch (_) {}`,
        `if (!__extjsBase && typeof globalThis === "object" && globalThis && globalThis.__EXTJS_EXTENSION_BASE__) {`,
        Template.indent([
          `__extjsBase = String(globalThis.__EXTJS_EXTENSION_BASE__ || "");`
        ]),
        `}`,
        `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
        Template.indent([
          `try { __extjsBase = String(document.documentElement.getAttribute("data-extjs-extension-base") || ""); } catch (_) { __extjsBase = ""; }`
        ]),
        `}`,
        `if (__extjsBase) {`,
        Template.indent([`${RuntimeGlobals.baseURI} = __extjsBase;`]),
        `} else if (typeof document !== "undefined" && document.baseURI) {`,
        Template.indent([`${RuntimeGlobals.baseURI} = document.baseURI;`]),
        `} else {`,
        Template.indent([`${RuntimeGlobals.baseURI} = self.location.href;`]),
        `}`
      ])
    }
  }

  return new BaseUriRuntime()
}
