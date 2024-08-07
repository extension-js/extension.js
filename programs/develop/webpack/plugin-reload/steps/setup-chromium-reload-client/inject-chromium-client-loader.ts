import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'
import {type Manifest} from '../../../webpack-types'

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

interface InjectBackgroundClientContext extends LoaderContext<any> {
  getOptions: () => {
    manifestPath: string
  }
}

export default function (this: InjectBackgroundClientContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest: Manifest = require(manifestPath)

  validate(schema, options, {
    name: 'Inject Reload (background.scripts and background.service_worker) Script',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)

  const generalReloadCode = `
  ;chrome.runtime.onMessageExternal.addListener(
    async (request, _sender, sendResponse) => {
      const managementInfo = await new Promise((resolve) => {
        chrome.management.getSelf(resolve);
      });
 
      // Ping-pong between the user extension background page(this)
      // and the middleware socket client (reloadService.ts),
      // which will then send a message to the server
      // (startServer.ts) so it can display the extension info.
      if (request.initialLoadData) {
        sendResponse({
          id: chrome.runtime.id,
          manifest: chrome.runtime.getManifest(),
          management: managementInfo,
        })
        return true
      }
  
      // Reload the extension runtime if the manifest or
      // service worker changes. 
      if (
        request.changedFile === 'manifest.json' ||
        request.changedFile === 'service_worker' ||
        request.changedFile === '_locales'
      ) {
        setTimeout(() => {
          sendResponse({reloaded: true})
          chrome.runtime.reload()
        }, 750)
      }

      // Reload all tabs if the contextMenus code changes.
      if (request.changedFile === 'contextMenus') {
        sendResponse({reloaded: true})
        chrome.tabs.query({}, (tabs) => {
          if (!tabs) return
          tabs.forEach((tab) => chrome.tabs.reload(tab.id))
        })
      }

      // Reload all tabs if the declarative_net_request code changes.
      if (request.changedFile === 'declarative_net_request') {
        sendResponse({reloaded: true})
        chrome.runtime.reload()
      }
  
      return true
    }
  );
  `
  if (manifest.background) {
    if (manifest.background.scripts) {
      for (const bgScript of [manifest.background.scripts[0]]) {
        const absoluteUrl = path.resolve(projectPath, bgScript as string)

        if (url.includes(absoluteUrl)) {
          return `${generalReloadCode}${source}`
        }
      }
    }

    if (manifest.background.service_worker) {
      const absoluteUrl = path.resolve(
        projectPath,
        manifest.background.service_worker as string
      )
      if (url.includes(absoluteUrl)) {
        return `${generalReloadCode}${source}`
      }
    }
  }

  return source
}
