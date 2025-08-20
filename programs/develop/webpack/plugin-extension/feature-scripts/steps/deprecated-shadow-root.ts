import * as path from 'path'
import * as fs from 'fs'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../webpack-types'
import * as messages from '../../../webpack-lib/messages'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    }
  }
}

export default function (this: LoaderContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  validate(schema, options, {
    name: 'scripts:deprecated-shadow-root',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)
  const patchCssTag = `
;const appendStyleElementForLegacyShadowRoot = (legacyShadowRoot, stylesheets) => {
  if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
    const styleElement = document.createElement('link')
    styleElement.rel = 'stylesheet'
    styleElement.href = (typeof chrome !== 'undefined' ? chrome : browser).runtime.getURL('content_scripts/content-0.css')
    legacyShadowRoot.appendChild(styleElement)
  }
}

function injectStyles() {
  const legacyShadowRoot = window.__EXTENSION_SHADOW_ROOT__

  if (legacyShadowRoot) {
    appendStyleElementForLegacyShadowRoot(legacyShadowRoot)
  } else {
    // Use MutationObserver to wait for shadow root to be available
    const observer = new MutationObserver(() => {
      const shadowRoot = window.__EXTENSION_SHADOW_ROOT__

      if (shadowRoot) {
        appendStyleElementForLegacyShadowRoot(shadowRoot)
        observer.disconnect()
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })
  }
};injectStyles();`

  // 2 - Handle content_scripts.
  if (manifest.content_scripts) {
    for (const contentScript of manifest.content_scripts) {
      if (!contentScript.js) continue

      for (const js of contentScript.js) {
        const absoluteUrl = path.resolve(projectPath, js as string)

        if (url.includes(absoluteUrl)) {
          if (source.includes('__EXTENSION_SHADOW_ROOT__')) {
            if (process.env.EXTENSION_ENV === 'development') {
              console.warn(messages.deprecatedShadowRoot())
            }
            return `${patchCssTag}${source}`
          }

          return `${source}`
        }
      }
    }
  }

  return source
}
