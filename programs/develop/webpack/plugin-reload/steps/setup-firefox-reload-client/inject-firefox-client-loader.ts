import * as path from 'path'
import * as fs from 'fs'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from '@rspack/core'
import {type Schema} from 'schema-utils/declarations/validate'
import * as utils from '../../../lib/utils'
import {type Manifest} from '../../../webpack-types'
import {DevOptions} from '../../../../commands/commands-lib/config-types'
import * as messages from '../../../lib/messages'

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

interface InjectFirefoxClientContext extends LoaderContext<any> {
  getOptions: () => {
    manifestPath: string
    browser: string
  }
}

export default function (this: InjectFirefoxClientContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const browser = options.browser as DevOptions['browser']
  const projectPath = path.dirname(manifestPath)
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const patchedManifest = utils.filterKeysForThisBrowser(manifest, browser)

  validate(schema, options, {
    name: 'reload:inject-firefox-client',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)
  const firefoxReloadCode = `
  // Firefox-specific reload handler
  ;browser.runtime.onMessageExternal.addListener(
    async (request, _sender, sendResponse) => {
      const managementInfo = await new Promise((resolve) => {
        browser.management.getSelf().then(resolve);
      });
 
      // Handle initial load data
      if (request.initialLoadData) {
        sendResponse({
          id: browser.runtime.id,
          manifest: browser.runtime.getManifest(),
          management: managementInfo,
        })
        return true
      }
  
      // Enhanced reload logic for critical files in Firefox
      if (
        request.changedFile === 'manifest.json' ||
        request.changedFile === 'service_worker' ||
        request.changedFile === '_locales'
      ) {
        console.log('Firefox: Reloading extension due to critical file change:', request.changedFile);
        
        try {
          // Firefox-specific cache clearing
          if (browser.storage && browser.storage.local) {
            await browser.storage.local.clear(); // Note: Welcome page flags are preserved by the extension manager
          }
          
          const timestamp = Date.now();
          console.log('Firefox: Forcing extension reload at:', timestamp);
          
          sendResponse({reloaded: true, timestamp: timestamp})
          browser.runtime.reload()
        } catch (error) {
          console.error('Firefox: Failed to reload extension:', error);
          sendResponse({error: error.message})
        }
      }

      return true
    }
  );
  
  // Firefox-specific cache-busting mechanism
  ;(function() {
    const cacheBuster = Date.now();
    console.log('Firefox background script loaded with cache buster:', cacheBuster);
    
    // Force reload if this script is older than 1 second (optimized for faster manifest reloads)
    const scriptAge = Date.now() - cacheBuster;
    if (scriptAge > 1000) {
      console.log('Firefox background script is stale, forcing reload');
      browser.runtime.reload();
    }
  })();
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
            return `${firefoxReloadCode}${source}`
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
          return `${firefoxReloadCode}${source}`
        }
      }
    }
  }

  return source
}
