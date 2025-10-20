import fs from 'fs'
import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../../../webpack-types'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    },
    mode: {
      type: 'string'
    }
  }
}

export default function (this: LoaderContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  validate(schema, options, {
    name: 'scripts:add-hmr-accept-code',
    baseDataPath: 'options'
  })

  // If HMR accept code is already present
  // (injected by a framework wrapper), skip to avoid duplication
  if (source.includes('import.meta.webpackHot')) {
    return source
  }

  const url = urlToRequest(this.resourcePath)
  const reloadCodeBackground = `
// Extension.js HMR registration (injected)
if (import.meta.webpackHot) { try { import.meta.webpackHot.accept(); } catch (_) {} }
  `

  // 1 - Handle background.scripts.
  // We don't add this to service_worker because it's reloaded by
  // chrome.runtime.reload() and not by HMR.
  if (manifest.background) {
    if (manifest.background.scripts) {
      for (const bgScript of manifest.background.scripts) {
        const absoluteUrl = path.resolve(projectPath, bgScript as string)
        if (url.includes(absoluteUrl)) {
          return `${reloadCodeBackground}${source}`
        }
      }
    }
  }

  // 2 - Handle user_scripts.
  if (manifest.user_scripts) {
    for (const userScript of manifest.user_scripts) {
      const absoluteUrl = path.resolve(projectPath, userScript as string)
      if (url.includes(absoluteUrl)) {
        return `${reloadCodeBackground}${source}`
      }
    }
  }

  return source
}
