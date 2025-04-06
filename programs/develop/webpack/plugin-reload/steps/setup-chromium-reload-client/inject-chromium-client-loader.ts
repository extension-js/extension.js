import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from '@rspack/core'
import {type Schema} from 'schema-utils/declarations/validate'
import * as utils from '../../../lib/utils'
import {type Manifest} from '../../../webpack-types'
import {DevOptions} from '../../../../commands/commands-lib/config-types'

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
    browser: string
  }
}

export default function (this: InjectBackgroundClientContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const browser = options.browser as DevOptions['browser']
  const projectPath = path.dirname(manifestPath)
  const manifest: Manifest = require(manifestPath)
  const patchedManifest = utils.filterKeysForThisBrowser(manifest, browser)

  validate(schema, options, {
    name: 'reload:inject-background-client',
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
        request.changedFile === 'declarative_net_request' ||
        request.changedFile === 'manifest.json' ||
        request.changedFile === 'service_worker' ||
        request.changedFile === '_locales'
      ) {
        sendResponse({reloaded: true})
        chrome.runtime.reload()
      }

      return true
    }
  );
  `

  let manifestBg: Record<string, any> | undefined = patchedManifest.background

  // Check for background scripts
  if (manifestBg) {
    const backgroundScripts = manifestBg?.scripts

    if (backgroundScripts) {
      if (patchedManifest.manifest_version === 2) {
        for (const bgScript of [backgroundScripts[0]]) {
          const absoluteUrl = path.resolve(projectPath, bgScript as string)

          if (url.includes(absoluteUrl)) {
            return `${generalReloadCode}${source}`
          }
        }
      }
    }

    const serviceWorker = manifestBg?.service_worker

    // Check for service workers
    if (serviceWorker) {
      if (patchedManifest.manifest_version === 3) {
        const absoluteUrl = path.resolve(projectPath, serviceWorker as string)
        if (url.includes(absoluteUrl)) {
          return `${generalReloadCode}${source}`
        }
      }
    }
  }

  return source
}
