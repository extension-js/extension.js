import type * as webpack from 'webpack'
import {
  closedOnSlash,
  EXTENSION_BASE_ATTRIBUTE,
  extensionBaseFromFile,
  TAKEN_EXTENSION_BASE,
  unlessExtensionAddress
} from '../../../../../../../lib/extension-base-from-stack'
import {RuntimeGlobal} from './BrowserRuntime'

export default function PublicPathRuntimeModule(
  webpack: typeof import('webpack'),
  gecko = false,
  attribute: string = EXTENSION_BASE_ATTRIBUTE
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
        // A page owns the globals of its world, so the file goes from what
        // names it to the attribute its own bridge wrote.
        `var __extjsBase = ${extensionBaseFromFile(gecko)};`,
        `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
        Template.indent([
          `try { __extjsBase = document.documentElement.getAttribute(${JSON.stringify(attribute)}) || ""; } catch(_) { __extjsBase = ""; }`
        ]),
        `}`,
        ...(gecko ? [unlessExtensionAddress('__extjsBase')] : []),
        `var __extjsRuntimePath = "";`,
        // A Gecko file that opened on the taken base runs in the page's
        // world, where the only runtime to ask is one the page made up.
        `if (${gecko ? `typeof ${TAKEN_EXTENSION_BASE} !== "string" && ` : ''}${RuntimeGlobal} && ${RuntimeGlobal}.runtime && typeof ${RuntimeGlobal}.runtime.getURL === "function") {`,
        Template.indent([
          `try { __extjsRuntimePath = ${RuntimeGlobal}.runtime.getURL(${path}); } catch (_) { __extjsRuntimePath = ""; }`
        ]),
        `}`,
        ...(gecko ? [unlessExtensionAddress('__extjsRuntimePath')] : []),
        `if (__extjsRuntimePath) {`,
        Template.indent([`${RuntimeGlobals.publicPath} = __extjsRuntimePath;`]),
        `} else if (__extjsBase) {`,
        Template.indent([
          `${RuntimeGlobals.publicPath} = ${gecko ? closedOnSlash('__extjsBase') : '__extjsBase.replace(/\\/+$/, "/")'} + String(${path}).replace(/^\\/+/, "");`
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
              `try { base = document.documentElement.getAttribute(${JSON.stringify(attribute)}) || ""; } catch(_) { base = ""; }`,
              ...(gecko ? [unlessExtensionAddress('base')] : []),
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
