import {browser} from 'webextension-polyfill-ts'
browser.runtime.onMessageExternal.addListener(
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async (request: any, _sender: any) => {
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
      request.changedFile === 'manifest.json' ||
      request.changedFile === 'service_worker' ||
      request.changedFile === '_locales'
    ) {
      setTimeout(() => {
        browser.runtime.reload()
        return {reloaded: true}
      }, 750)
    }

    // Reload all tabs if the declarative_net_request code changes.
    if (request.changedFile === 'declarative_net_request') {
      browser.runtime.reload()
      return {reloaded: true}
    }

    return true
  }
)
