// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler, RuntimeModule} from '@rspack/core'
import {
  CHROMIUM_EXTENSION_SCHEME,
  closedOnSlash,
  EXTENSION_BASE_ATTRIBUTE,
  extensionBaseFromFile,
  GECKO_EXTENSION_SCHEME,
  TAKEN_EXTENSION_BASE,
  unlessExtensionAddress
} from '../../../lib/extension-base-from-stack'
import {RuntimeGlobal} from './browser-runtime'

// Derived from webpack-target-webextension (MIT, Copyright 2020 CRIMX).
// The license notice is in the README of this folder.

export function PublicPathRuntimeModule(
  webpack: Compiler['webpack'],
  gecko = false,
  attribute: string = EXTENSION_BASE_ATTRIBUTE,
  scheme: string = gecko ? GECKO_EXTENSION_SCHEME : CHROMIUM_EXTENSION_SCHEME
): RuntimeModule {
  const {RuntimeGlobals, RuntimeModule, Template} = webpack

  class PublicPathRuntime extends RuntimeModule {
    constructor() {
      super('publicPath', RuntimeModule.STAGE_BASIC)
    }

    generate(): string {
      const {compilation} = this

      if (!compilation) {
        return Template.asString(
          '/* [webpack-target-webextension] PublicPathRuntimeModule skipped because no compilation is found. */'
        )
      }

      const {publicPath} = compilation.outputOptions

      const path = JSON.stringify(
        compilation.getPath(publicPath || '', {
          hash: compilation.hash || 'XXXX'
        })
      )

      return Template.asString([
        // A page owns the globals of its world, so a file with no runtime
        // goes from what names it to the attribute its own bridge wrote.
        `var __extjsBase = ${extensionBaseFromFile(gecko)};`,
        `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
        Template.indent([
          `try { __extjsBase = document.documentElement.getAttribute(${JSON.stringify(attribute)}) || ""; } catch(_) { __extjsBase = ""; }`
        ]),
        `}`,
        unlessExtensionAddress('__extjsBase', scheme),
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
              unlessExtensionAddress('base', scheme),
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
