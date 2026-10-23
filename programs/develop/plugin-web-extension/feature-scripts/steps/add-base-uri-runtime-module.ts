// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'

// The bundler's base URI runtime is document.baseURI under the jsonp loader
// and undefined under no loader, and a worker has neither a document nor a
// usable undefined base, so a URL it built from the base threw on start.
// The bundler adds its module whatever a plugin answers, so this one runs
// at a later stage on a worker entry that needs the base and overrides it.
export class AddBaseUriRuntimeModule {
  apply(compiler: Compiler) {
    if (!compiler?.hooks?.compilation) return

    const {RuntimeGlobals} = compiler.webpack

    compiler.hooks.compilation.tap('BaseUriRuntimeModule', (compilation) => {
      compilation.hooks.additionalTreeRuntimeRequirements.tap(
        AddBaseUriRuntimeModule.name,
        (chunk, set) => {
          if (!isWorkerEntry(compiler, chunk.name)) return
          // The bundler names this requirement by its key, not its global.
          if (!set.has(RuntimeGlobals.baseURI) && !set.has('baseUri')) return

          compilation.addRuntimeModule(chunk, BaseUriRuntimeModule(compiler))
        }
      )
    })
  }
}

// The scripts step gives a worker entry the import-scripts loader or none
// at all; a page entry keeps the default.
function isWorkerEntry(compiler: Compiler, name: string | null | undefined) {
  if (!name) return false

  const entries = compiler.options.entry as Record<
    string,
    {chunkLoading?: unknown} | undefined
  >
  const chunkLoading = entries[name]?.chunkLoading

  return chunkLoading === false || chunkLoading === 'import-scripts'
}

// Extension root from the runtime when there is one, the bridge base for a
// MAIN world script, then the document, then the worker's own location.
export function baseUriRuntimeSource(baseUriGlobal: string): string[] {
  return [
    `var __extjsBase = "";`,
    `try {`,
    `  var __extjsApi = (typeof browser === "object" && browser && browser.runtime) ? browser : (typeof chrome === "object" && chrome && chrome.runtime) ? chrome : null;`,
    `  if (__extjsApi && typeof __extjsApi.runtime.getURL === "function") __extjsBase = String(__extjsApi.runtime.getURL("/"));`,
    `} catch (_) { __extjsBase = ""; }`,
    `if (!__extjsBase && typeof globalThis === "object" && globalThis && globalThis.__EXTJS_EXTENSION_BASE__) {`,
    `  __extjsBase = String(globalThis.__EXTJS_EXTENSION_BASE__ || "");`,
    `}`,
    `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
    `  try { __extjsBase = String(document.documentElement.getAttribute("data-extjs-extension-base") || ""); } catch (_) { __extjsBase = ""; }`,
    `}`,
    `if (__extjsBase) {`,
    `  ${baseUriGlobal} = __extjsBase;`,
    `} else if (typeof document === "object" && document && document.baseURI) {`,
    `  ${baseUriGlobal} = document.baseURI;`,
    `} else if (typeof self === "object" && self && self.location && self.location.href) {`,
    `  ${baseUriGlobal} = self.location.href;`,
    `}`
  ]
}

function BaseUriRuntimeModule(compiler: Compiler) {
  const {Template, RuntimeModule, RuntimeGlobals} = compiler.webpack

  class BaseUriRuntimeModule extends RuntimeModule {
    constructor() {
      super('extension base uri', RuntimeModule.STAGE_ATTACH)
    }

    generate() {
      return Template.asString(baseUriRuntimeSource(RuntimeGlobals.baseURI))
    }
  }

  return new BaseUriRuntimeModule()
}
