import path from 'path'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type LoaderContext} from 'webpack'
import {type Schema} from 'schema-utils/declarations/validate'
import {type Manifest} from '../types'

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
  const manifest: Manifest = require(manifestPath)

  validate(schema, options, {
    name: 'Inject Reload (background.scripts and background.service_worker) Script',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)

  const generalReloadCode = `
  ;browser.runtime.onMessageExternal.addListener(
    async (request, _sender) => {
      const managementInfo = await new Promise((resolve) => {
        browser.management.getSelf(resolve);
      });

      // Ping-pong between the user extension background page(this)
      // and the middleware socket client (reloadService.ts),
      // which will then send a message to the server
      // (startServer.ts) so it can display the extension info.
      if (request.initialLoadData) {
        return {
          id: browser.runtime.id,
          manifest: browser.runtime.getManifest(),
          management: managementInfo,
        };
      }

      // Reload the extension runtime if the manifest or
      // service worker changes.
      if (
        request.changedFile === "manifest.json" ||
        request.changedFile === "service_worker" ||
        request.changedFile === "_locales"
      ) {
        setTimeout(() => {
          browser.runtime.reload();
        }, 750);
      }

      // Reload all tabs if the contextMenus code changes.
      if (request.changedFile === "contextMenus") {
        browser.tabs.query({}, (tabs) => {
          if (!tabs) return;
          tabs.forEach((tab) => browser.tabs.reload(tab.id));
        });
      }

      // Reload all tabs if the declarative_net_request code changes.
      if (request.changedFile === "declarative_net_request") {
        browser.runtime.reload();
      }

      return { reloaded: true };
    }
  );
  `
  // Let the react reload plugin handle the reload.
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
