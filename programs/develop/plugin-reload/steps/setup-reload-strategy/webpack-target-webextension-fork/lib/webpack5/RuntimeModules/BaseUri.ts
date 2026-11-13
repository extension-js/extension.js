import type * as webpack from 'webpack'
import {
  CHROMIUM_EXTENSION_SCHEME,
  EXTENSION_BASE_ATTRIBUTE,
  extensionBaseFromFile,
  GECKO_EXTENSION_SCHEME,
  unlessExtensionAddress
} from '../../../../../../../lib/extension-base-from-stack'
import {RuntimeGlobal} from './BrowserRuntime'

export default function BaseUriRuntimeModule(
  webpack: typeof import('webpack'),
  gecko = false,
  attribute: string = EXTENSION_BASE_ATTRIBUTE,
  scheme: string = gecko ? GECKO_EXTENSION_SCHEME : CHROMIUM_EXTENSION_SCHEME
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
        `if (!__extjsBase) __extjsBase = ${extensionBaseFromFile(gecko)};`,
        `if (!__extjsBase && typeof document === "object" && document && document.documentElement) {`,
        Template.indent([
          `try { __extjsBase = String(document.documentElement.getAttribute(${JSON.stringify(attribute)}) || ""); } catch (_) { __extjsBase = ""; }`
        ]),
        `}`,
        unlessExtensionAddress('__extjsBase', scheme),
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
