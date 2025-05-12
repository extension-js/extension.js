import * as path from 'path'
import * as fs from 'fs'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from '@rspack/core'
import {type Schema} from 'schema-utils/declarations/validate'
import * as utils from '../../../lib/utils'
import * as messages from '../../../lib/messages'
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
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const patchedManifest = utils.filterKeysForThisBrowser(manifest, browser)

  validate(schema, options, {
    name: 'reload:inject-background-client',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)

  const generalReloadCode = `
;browser.runtime.onMessageExternal.addListener(async (request, _sender) => {
  const managementInfo = await browser.management.getSelf()

  // Ping-pong between the user extension background page(this)
  // and the middleware socket client (reloadService.ts),
  // which will then send a message to the server
  // (startServer.ts) so it can display the extension info.
  if (request.initialLoadData) {
    return {
      id: browser.runtime.id,
      manifest: browser.runtime.getManifest(),
      management: managementInfo
    }
  }

  // Reload the extension runtime if the manifest or
  // service worker changes.
  if (
    request.changedFile === 'declarative_net_request' ||
    request.changedFile === 'manifest.json' ||
    request.changedFile === 'service_worker' ||
    request.changedFile === '_locales'
  ) {
    browser.runtime.reload()
  }

  return {reloaded: true}
});`

  // Handling for specific browsers
  const manifestBg = patchedManifest.background

  if (patchedManifest.service_worker) {
    console.log(messages.firefoxServiceWorkerError())

    return source
  }

  if (manifestBg) {
    const backgroundScripts = manifestBg?.scripts

    if (backgroundScripts) {
      for (const bgScript of [backgroundScripts[0]]) {
        const absoluteUrl = path.resolve(projectPath, bgScript as string)

        if (url.includes(absoluteUrl)) {
          return `${generalReloadCode}${source}`
        }
      }
    }
  }

  return source
}
