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
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {
  closedOnSlash,
  extensionBaseFromFile,
  extensionSchemeFor,
  TAKEN_EXTENSION_BASE,
  unlessExtensionAddress
} from '../../../lib/extension-base-from-stack'
import type {DevOptions} from '../../../types'
import {extensionBaseAttributeFor} from '../scripts-lib/taken-extension-base'

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
  constructor(
    private readonly options: {
      browser?: DevOptions['browser']
      manifestPath?: string
    } = {}
  ) {}

  apply(compiler: Compiler) {
    const {RuntimeGlobals} = compiler.webpack
    // A Gecko MAIN world file opens on the read that takes the base.
    const gecko = isGeckoBasedBrowser(String(this.options.browser || 'chrome'))
    // The bridge of this extension writes the base under its own name.
    const attribute = extensionBaseAttributeFor(
      this.options.manifestPath,
      this.options.browser || 'chrome'
    )

    const scheme = extensionSchemeFor(String(this.options.browser || 'chrome'))

    compiler.hooks.compilation.tap('PublicPathRuntimeModule', (compilation) => {
      compilation.hooks.runtimeRequirementInTree
        .for(RuntimeGlobals.publicPath)
        .tap(AddPublicPathRuntimeModule.name, (chunk) => {
          const module = PublicPathRuntimeModule(
            compiler,
            gecko,
            attribute,
            scheme
          )

          compilation.addRuntimeModule(chunk, module)

          return true
        })
    })
  }
}

function PublicPathRuntimeModule(
  compiler: Compiler,
  gecko: boolean,
  attribute: string,
  scheme: string
) {
  const {Template, RuntimeModule, RuntimeGlobals} = compiler.webpack
  class PublicPathRuntimeModule extends RuntimeModule {
    constructor() {
      super('publicPath', RuntimeModule.STAGE_BASIC)
    }

    generate() {
      const publicPath = this.compilation?.outputOptions.publicPath

      return Template.asString([
        ...weakRuntimeCheck,
        // A page owns every other global of a MAIN world file, so the
        // file goes from what names it straight to the document.
        `var __extjsBase = ${extensionBaseFromFile(gecko)};`,
        `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
        Template.indent([
          `try { __extjsBase = document.documentElement.getAttribute(${JSON.stringify(attribute)}) || ""; } catch(_) { __extjsBase = ""; }`
        ]),
        `}`,
        unlessExtensionAddress('__extjsBase', scheme),
        `var path = ${JSON.stringify(
          this.compilation?.getPath((publicPath as string) || '', {
            hash: this.compilation.hash || 'XXXX'
          })
        )}`,
        `var __extjsRuntimePath = "";`,
        // A Gecko file that opened on the taken base runs in the page's
        // world, where the only runtime to ask is one the page made up.
        gecko
          ? `if (!(typeof importScripts === 'function') && typeof ${TAKEN_EXTENSION_BASE} !== "string" && (isBrowser || isChrome)) {`
          : `if (!(typeof importScripts === 'function') && (isBrowser || isChrome)) {`,
        Template.indent([
          `try { __extjsRuntimePath = runtime.runtime.getURL(path); } catch (_) { __extjsRuntimePath = ""; }`
        ]),
        `}`,
        ...(gecko ? [unlessExtensionAddress('__extjsRuntimePath')] : []),
        // Precedence: worker keeps the configured path, a live runtime wins,
        // then the isolated-world bridge base. The bridge exists FOR the
        // MAIN world, where no runtime is available, so the base must be
        // consulted exactly when the runtime path comes back empty.
        `${RuntimeGlobals.publicPath} = typeof importScripts === 'function' ? path : (__extjsRuntimePath || (__extjsBase ? ${gecko ? closedOnSlash('__extjsBase') : '__extjsBase.replace(/\\/+$/, "/")'} + String(path).replace(/^\\/+/, "") : path));`
      ])
    }
  }

  return new PublicPathRuntimeModule()
}
