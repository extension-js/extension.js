import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'

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

interface InjectBackgroundAcceptContext extends LoaderContext<any> {
  getOptions: () => {
    manifestPath: string
  }
}

export default function (this: InjectBackgroundAcceptContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = require(manifestPath)

  validate(schema, options, {
    name: 'Inject Reload (background.scripts and background.service_worker) Script',
    baseDataPath: 'options'
  })

  if (this._compilation?.options.mode === 'production') return source

  const url = urlToRequest(this.resourcePath)
  const reloadCode = `
;chrome.runtime.onMessageExternal.addListener(
  async (request, _sender, sendResponse) => {
    const managementInfo = await new Promise((resolve) => {
      chrome.management.getSelf(resolve);
    });

    if (request.initialLoadData) {
      sendResponse({
        id: chrome.runtime.id,
        manifest: chrome.runtime.getManifest(),
        management: managementInfo
      })
      return true
    }

    if (
      request.changedFile === 'manifest.json' ||
      request.changedFile === 'service_worker'
    ) {
      sendResponse({reloaded: true})
      setTimeout(() => {
        chrome.runtime.reload()
      }, 1000)
    }

    return true
  }
);
  `

  // Let the react reload plugin handle the reload.
  if (manifest.background) {
    if (manifest.background.scripts) {
      for (const bgScript of [manifest.background.scripts[0]]) {
        const absoluteUrl = path.resolve(projectPath, bgScript)

        if (url.includes(absoluteUrl)) {
          return `${reloadCode}${source}`
        }
      }
    }

    if (manifest.background.service_worker) {
      const absoluteUrl = path.resolve(
        projectPath,
        manifest.background.service_worker
      )
      if (url.includes(absoluteUrl)) {
        return `${reloadCode}${source}`
      }
    }
  }

  return source
}
