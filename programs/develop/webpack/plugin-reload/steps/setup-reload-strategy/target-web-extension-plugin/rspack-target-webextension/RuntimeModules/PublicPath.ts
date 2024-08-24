import {rspack, Compilation, sources} from '@rspack/core'
import BrowserRuntime from '../BrowserRuntime'

export function PublicPathRuntimeModule(
  rspackLib: typeof rspack,
  acceptWeak: boolean
) {
  const {RuntimeGlobals, Template} = rspackLib

  function generate(compilation: Compilation) {
    if (!compilation) {
      return Template.asString(
        '/* [webpack-target-webextension] PublicPathRuntimeModule skipped because no compilation is found. */'
      )
    }
    const {publicPath} = compilation.outputOptions

    return Template.asString([
      ...BrowserRuntime(acceptWeak),
      `var path = ${JSON.stringify(
        compilation.getPath(publicPath || '', {
          hash: compilation.hash || 'XXXX'
        })
      )}`,
      `${RuntimeGlobals.publicPath} = typeof importScripts === 'function' || !(isBrowser || isChrome) ? path : runtime.runtime.getURL(path);`
    ])
  }

  return {
    name: 'PublicPathRuntimeModule',
    generate
  }
}
