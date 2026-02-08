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
        // In MAIN world content scripts, runtime is missing; fall back to a base URL
        // set by the isolated-world bridge (or empty as last resort).
        `var __extjsBase = (typeof globalThis === "object" && globalThis && globalThis.__EXTJS_EXTENSION_BASE__) ? String(globalThis.__EXTJS_EXTENSION_BASE__) : "";`,
        `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
        Template.indent([
          `try { __extjsBase = document.documentElement.getAttribute("data-extjs-extension-base") || ""; } catch(_) { __extjsBase = ""; }`
        ]),
        `}`,
        `if (${RuntimeGlobal} && ${RuntimeGlobal}.runtime && typeof ${RuntimeGlobal}.runtime.getURL === "function") {`,
        Template.indent([
          `${RuntimeGlobals.publicPath} = ${RuntimeGlobal}.runtime.getURL(${path});`
        ]),
        `} else if (__extjsBase) {`,
        Template.indent([
          `${RuntimeGlobals.publicPath} = __extjsBase.replace(/\\/+$/, "/") + String(${path}).replace(/^\\/+/, "");`
        ]),
        `} else {`,
        Template.indent([`${RuntimeGlobals.publicPath} = "";`]),
        `}`,
        `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
        Template.indent([
          `try {`,
          Template.indent([
            `var __extjsRetries = 0;`,
            `var __extjsUpdateBase = function(){`,
            Template.indent([
              `var base = "";`,
              `try { base = document.documentElement.getAttribute("data-extjs-extension-base") || ""; } catch(_) { base = ""; }`,
              `if (base) {`,
              Template.indent([
                `${RuntimeGlobals.publicPath} = base.replace(/\\/+$/, "/") + String(${path}).replace(/^\\/+/, "");`
              ]),
              `} else if (__extjsRetries++ < 50) {`,
              Template.indent([`setTimeout(__extjsUpdateBase, 100);`]),
              `}`
            ]),
            `};`,
            `__extjsUpdateBase();`
          ]),
          `} catch (_) {}`
        ]),
        `}`
      ])
    }
  }

  return new PublicPathRuntime()
}
