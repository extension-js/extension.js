// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {
  EXTENSION_BASE_ATTRIBUTE,
  extensionBaseFromFile,
  unlessExtensionAddress
} from '../../../lib/extension-base-from-stack'
import type {DevOptions} from '../../../types'
import {extensionBaseAttributeFor} from '../scripts-lib/taken-extension-base'

// The bundler's base URI runtime is document.baseURI under the jsonp loader
// and undefined under no loader, and a worker has neither a document nor a
// usable undefined base, so a URL it built from the base threw on start.
// The bundler adds its module whatever a plugin answers, so this one runs
// at a later stage on a worker entry that needs the base and overrides it.
export class AddBaseUriRuntimeModule {
  constructor(
    private readonly options: {
      browser?: DevOptions['browser']
      manifestPath?: string
    } = {}
  ) {}

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.compilation) return

    const {RuntimeGlobals} = compiler.webpack
    const browser = this.options.browser || 'chrome'
    const gecko = isGeckoBasedBrowser(String(browser))
    const attribute = extensionBaseAttributeFor(
      this.options.manifestPath,
      browser
    )

    compiler.hooks.compilation.tap('BaseUriRuntimeModule', (compilation) => {
      compilation.hooks.additionalTreeRuntimeRequirements.tap(
        AddBaseUriRuntimeModule.name,
        (chunk, set) => {
          if (!isWorkerEntry(compiler, chunk.name)) return
          // The bundler names this requirement by its key, not its global.
          if (!set.has(RuntimeGlobals.baseURI) && !set.has('baseUri')) return

          compilation.addRuntimeModule(
            chunk,
            BaseUriRuntimeModule(compiler, gecko, attribute)
          )
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
export function baseUriRuntimeSource(
  baseUriGlobal: string,
  gecko = false,
  attribute: string = EXTENSION_BASE_ATTRIBUTE
): string[] {
  return [
    `var __extjsBase = "";`,
    `try {`,
    `  var __extjsApi = (typeof browser === "object" && browser && browser.runtime) ? browser : (typeof chrome === "object" && chrome && chrome.runtime) ? chrome : null;`,
    `  if (__extjsApi && typeof __extjsApi.runtime.getURL === "function") __extjsBase = String(__extjsApi.runtime.getURL("/"));`,
    `} catch (_) { __extjsBase = ""; }`,
    // A page owns the globals of its world, so a file there goes from
    // what names it to the attribute its own bridge wrote.
    `if (!__extjsBase) __extjsBase = ${extensionBaseFromFile(gecko)};`,
    `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
    `  try { __extjsBase = String(document.documentElement.getAttribute(${JSON.stringify(attribute)}) || ""); } catch (_) { __extjsBase = ""; }`,
    `}`,
    ...(gecko ? [unlessExtensionAddress('__extjsBase')] : []),
    `if (__extjsBase) {`,
    `  ${baseUriGlobal} = __extjsBase;`,
    `} else if (typeof document === "object" && document && document.baseURI) {`,
    `  ${baseUriGlobal} = document.baseURI;`,
    `} else if (typeof self === "object" && self && self.location && self.location.href) {`,
    `  ${baseUriGlobal} = self.location.href;`,
    `}`
  ]
}

function BaseUriRuntimeModule(
  compiler: Compiler,
  gecko: boolean,
  attribute: string
) {
  const {Template, RuntimeModule, RuntimeGlobals} = compiler.webpack

  class BaseUriRuntimeModule extends RuntimeModule {
    constructor() {
      super('extension base uri', RuntimeModule.STAGE_ATTACH)
    }

    generate() {
      return Template.asString(
        baseUriRuntimeSource(RuntimeGlobals.baseURI, gecko, attribute)
      )
    }
  }

  return new BaseUriRuntimeModule()
}
