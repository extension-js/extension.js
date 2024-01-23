chrome.runtime.onMessageExternal.addListener(
  (request, _sender, sendResponse) => {
    if (request.initialLoadData) {
      sendResponse({
        id: chrome.runtime.id,
        manifest: chrome.runtime.getManifest()
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
)
