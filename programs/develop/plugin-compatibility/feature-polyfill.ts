//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import rspack, {type Compiler} from '@rspack/core'
import {recordCodedWarning} from '../lib/coded-warnings'
import {CODES, debugLine, isDebug} from '../lib/messaging'
import {
  EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER,
  EXTENSIONJS_SANDBOX_LAYER,
  isMainWorldCompiler
} from '../plugin-web-extension/feature-scripts/contracts'
import type {DevOptions} from '../types'
import * as messages from './compatibility-lib/messages'
import {
  filesWithNoExtensionApi,
  resourceKey
} from './compatibility-lib/no-extension-api-files'

const cjsRequire = createRequire(import.meta.url)

// A MAIN world script runs on the page and a sandboxed page has no extension
// API, so the polyfill throws there. Such code reads the page's own global.
const PAGE_BROWSER_GLOBAL =
  'data:application/node,module.exports%20%3D%20globalThis.browser'

export class PolyfillPlugin {
  public static readonly name: string = 'compatibility:polyfill'

  public readonly browser: DevOptions['browser']
  public readonly manifestPath?: string

  constructor(
    options: {browser?: DevOptions['browser']; manifestPath?: string} = {}
  ) {
    this.browser = options.browser || 'chrome'
    this.manifestPath = options.manifestPath
  }

  apply(compiler: Compiler) {
    let polyfillPath: string

    try {
      // Resolve the polyfill preferring the consumer project first: package
      // managers may hoist it to the project root, not under extension-develop.
      polyfillPath = cjsRequire.resolve(
        'webextension-polyfill/dist/browser-polyfill.js',
        {
          paths: [compiler.options.context as string, __dirname].filter(Boolean)
        }
      )
    } catch (error) {
      // Only a missing package turns the polyfill off. Any other failure is
      // not "not installed", so it surfaces as the error it is.
      if ((error as NodeJS.ErrnoException)?.code !== 'MODULE_NOT_FOUND') {
        throw error
      }

      recordCodedWarning(
        CODES.W_POLYFILL_NOT_FOUND,
        'webextension-polyfill is not installed, so the browser API polyfill is off for this build.'
      )

      console.warn(messages.webextensionPolyfillNotFound())

      return
    }

    const currentResolve = compiler.options.resolve || {}
    const existingAlias = currentResolve.alias || {}

    compiler.options.resolve = {
      ...currentResolve,
      alias: {
        ...existingAlias,
        // Use `$` to exactly match the package name
        'webextension-polyfill$': polyfillPath
      }
    }

    // The path, not the package name, so an import the author wrote stays as
    // written and only the provided global is redirected below.
    new rspack.ProvidePlugin({browser: polyfillPath}).apply(compiler)

    let noExtensionApi = new Set<string>()

    compiler.hooks.thisCompilation.tap(PolyfillPlugin.name, () => {
      noExtensionApi = this.manifestPath
        ? filesWithNoExtensionApi(compiler, this.manifestPath, this.browser)
        : new Set()
    })

    // Tapped on every compilation, so the dev build of MAIN world groups,
    // which compiles apart, is covered too.
    compiler.hooks.compilation.tap(
      PolyfillPlugin.name,
      (compilation, {normalModuleFactory}) => {
        // A dev MAIN world compiler builds page code alone, so a file the
        // isolated world shares gets no polyfill in this copy either.
        const onPage = isMainWorldCompiler(compilation.compiler)

        normalModuleFactory.hooks.beforeResolve.tap(
          PolyfillPlugin.name,
          (data) => {
            if (data?.request !== polyfillPath) return

            const {issuer, issuerLayer} = data.contextInfo || {}

            if (
              onPage ||
              issuerLayer === EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER ||
              issuerLayer === EXTENSIONJS_SANDBOX_LAYER ||
              noExtensionApi.has(resourceKey(issuer))
            ) {
              data.request = PAGE_BROWSER_GLOBAL
            }
          }
        )
      }
    )

    if (isDebug()) {
      debugLine(
        messages.compatibilityPolyfillEnabled(this.browser, polyfillPath)
      )
    }
  }
}
