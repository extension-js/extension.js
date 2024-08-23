// This source file is adapted from
// https://github.com/awesome-webextension/webpack-target-webextension
// Released under the MIT License.

import {
  Compilation,
  Compiler,
  RuntimeGlobals,
  Template,
  sources
} from '@rspack/core'

const basic = [
  `var isBrowser = !!(() => { try { return browser.runtime.getURL("/") } catch(e) {} })()`,
  `var isChrome = !!(() => { try { return chrome.runtime.getURL("/") } catch(e) {} })()`
]

const weakRuntimeCheck = [
  ...basic,
  `var runtime = isBrowser ? browser : isChrome ? chrome : (typeof self === 'object' && self.addEventListener) ? { get runtime() { throw new Error("No chrome or browser runtime found") } } : { runtime: { getURL: x => x } }`
]

export class AddPublicPathRuntimeModule {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'scripts:add-public-path-runtime-module',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'scripts:add-public-path-runtime-module',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
          },
          () => {
            const publicPath = compilation.outputOptions.publicPath || ''
            const path = JSON.stringify(
              compilation.getPath(publicPath, {
                hash: compilation.hash || 'XXXX'
              })
            )

            const runtimeSource = Template.asString([
              ...weakRuntimeCheck,
              `${RuntimeGlobals.publicPath} = typeof importScripts === 'function' || !(isBrowser || isChrome) ? ${path} : runtime.runtime.getURL(${path});`
            ])

            // Iterate through all chunks and inject the runtime code where necessary
            for (const chunk of compilation.chunks) {
              for (const file of chunk.files) {
                const existingSource = compilation.assets[file]
                const combinedSource = new sources.ConcatSource(
                  existingSource,
                  new sources.RawSource(runtimeSource)
                )
                compilation.updateAsset(file, combinedSource)
              }
            }
          }
        )
      }
    )
  }
}
