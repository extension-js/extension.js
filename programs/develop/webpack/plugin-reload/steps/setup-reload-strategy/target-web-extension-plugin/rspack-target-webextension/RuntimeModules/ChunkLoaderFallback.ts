import {type rspack} from '@rspack/core'

export function ChunkLoaderFallbackRuntimeModule(webpack: typeof rspack) {
  const {RuntimeModule, Template} = webpack
  class ChunkLoaderFallbackRuntimeModule extends RuntimeModule {
    constructor() {
      super('chunk loader fallback', RuntimeModule.STAGE_TRIGGER)
    }
    generate() {
      return Template.getFunctionContent(runtime)
    }
  }
  return new ChunkLoaderFallbackRuntimeModule()
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
  runtime.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const cond =
      message &&
      message.type === 'WTW_INJECT' &&
      sender &&
      sender.tab &&
      sender.tab.id != null
    if (!cond) return
    let file = message.file
    try {
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
  })
}
