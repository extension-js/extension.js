chrome.runtime.onMessageExternal.addListener(
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async (request, _sender, sendResponse) => {
    const managementInfo = await new Promise((resolve) => {
      chrome.management.getSelf(resolve)
    })

    // Ping-pong between the user extension background page(this)
    // and the middleware socket client (reloadService.ts),
    // which will then send a message to the server
    // (startServer.ts) so it can display the extension info.
    if (request.initialLoadData) {
      sendResponse({
        id: chrome.runtime.id,
        manifest: chrome.runtime.getManifest(),
        management: managementInfo
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
)
