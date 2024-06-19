// This source file is adapted from
// https://github.com/awesome-webextension/webpack-target-webextension
// Released under the MIT License.

import {RuntimeGlobals, RuntimeModule, Template, type Compiler} from 'webpack'

const basic = [
  `var isBrowser = !!(() => { try { return browser.runtime.getURL("/") } catch(e) {} })()`,
  `var isChrome = !!(() => { try { return chrome.runtime.getURL("/") } catch(e) {} })()`
]

const weakRuntimeCheck = [
  ...basic,
  `var runtime = isBrowser ? browser : isChrome ? chrome : (typeof self === 'object' && self.addEventListener) ? { get runtime() { throw new Error("No chrome or browser runtime found") } } : { runtime: { getURL: x => x } }`
]

export default class AddPublicPathRuntimeModule {
  apply(compiler: Compiler) {
    const {RuntimeGlobals} = compiler.webpack

    compiler.hooks.compilation.tap('PublicPathRuntimeModule', (compilation) => {
      compilation.hooks.runtimeRequirementInTree
        .for(RuntimeGlobals.publicPath)
        .tap(AddPublicPathRuntimeModule.name, (chunk) => {
          const module = PublicPathRuntimeModule()

          compilation.addRuntimeModule(chunk, module)

          return true
        })
    })
  }
}

function PublicPathRuntimeModule() {
  class PublicPathRuntimeModule extends RuntimeModule {
    constructor() {
      super('publicPath', RuntimeModule.STAGE_BASIC)
    }

    generate() {
      const publicPath = this.compilation?.outputOptions.publicPath

      return Template.asString([
        ...weakRuntimeCheck,
        `var path = ${JSON.stringify(
          this.compilation?.getPath(publicPath || '', {
            hash: this.compilation.hash || 'XXXX'
          })
        )}`,
        `${RuntimeGlobals.publicPath} = typeof importScripts === 'function' || !(isBrowser || isChrome) ? path : runtime.runtime.getURL(path);`
      ])
    }
  }

  return new PublicPathRuntimeModule()
}
