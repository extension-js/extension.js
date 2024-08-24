import {rspack, Compilation} from '@rspack/core'

export function ChunkLoaderFallbackRuntimeModule(rspackLib: typeof rspack) {
  const {Template} = rspackLib

  return {
    name: 'ChunkLoaderFallbackRuntimeModule',
    generate(_compilation: Compilation) {
      return Template.getFunctionContent(runtime)
    }
  }
}

var browser: any
var chrome: any
var URL: string

const runtime = function () {
  const isBrowser = !!(() => {
    try {
      if (typeof browser.runtime.getURL === 'function') return true
    } catch (err) {}
  })()

  const runtime = isBrowser ? browser : chrome
  runtime.runtime.onMessage.addListener(
    // @ts-expect-error
    (message, sender, sendResponse) => {
      const cond =
        message &&
        message.type === 'WTW_INJECT' &&
        sender &&
        sender.tab &&
        sender.tab.id != null
      if (!cond) return

      let file: string = message.file

      try {
        // @ts-expect-error
        file = new URL(file).pathname
      } catch {}

      if (!file) return

      if (runtime.scripting) {
        runtime.scripting
          .executeScript({
            target: {tabId: sender.tab.id, frameIds: [sender.frameId]},
            files: [file]
          })
          .then(sendResponse)
      } else {
        const details = {frameId: sender.frameId, file, matchAboutBlank: true}

        if (isBrowser) {
          runtime.tabs.executeScript(sender.tab.id, details).then(sendResponse)
        } else {
          runtime.tabs.executeScript(sender.tab.id, details, sendResponse)
        }
      }

      return true
    }
  )
}
