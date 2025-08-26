import {createExtensionsPageTab, handleFirstRun} from './define-initial-tab.js'
import {connect, disconnect, keepAlive} from './reload-service.js'

function bgGreen(str) {
  return `background: transparent; color: #0971fe; ${str}`
}

// Guard tab access and run after startup
chrome.runtime.onStartup.addListener(async () => {
  try {
    chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
      const initialTab = Array.isArray(tabs) ? tabs[0] : undefined

      console.log(
        `%c
██████████████████████████████████████████████████████████
██████████████████████████████████████████████████████████
████████████████████████████    ██████████████████████████
█████████████████████████        ██████    ███████████████
███████████████████████     ███   ███         ████████████
██████████████████████    ██████        ███    ███████████
███████████████████████     ██████    ██████   ███████████
████████████████   ██████   ██████████████     ███████████
█████████████       ████    ████████████      ████████████
███████████     ██         █████████████   ███████████████
██████████    ██████    █████████████████    █████████████
███████████    ████████████████████████████    ███████████
█████████████    █████████████████    ██████    ██████████
███████████████   ██████████████        ██      ██████████
████████████      ████████████    ████       █████████████
███████████      █████████████   ██████    ███████████████
███████████   ██████    ██████     ███████████████████████
███████████    ████       ██████    ██████████████████████
████████████         ██    ███     ███████████████████████
███████████████    ██████        █████████████████████████
██████████████████████████    ████████████████████████████
██████████████████████████████████████████████████████████
██████████████████████████████████████████████████████████
MIT (c) ${new Date().getFullYear()} - Cezar Augusto and the Extension.js Authors.
`,
        bgGreen('')
      )

      if (!initialTab) {
        await handleFirstRun()
        return
      }

      if (
        initialTab.url === 'chrome://newtab/' ||
        initialTab.url === 'chrome://welcome/'
      ) {
        await handleFirstRun()
      } else {
        createExtensionsPageTab(initialTab, 'chrome://extensions/')
      }
    })
  } catch {}
})

chrome.runtime.onInstalled.addListener(async () => {
  let isConnected = false

  if (isConnected) {
    disconnect()
  } else {
    await connect()
    isConnected = true
    keepAlive()
  }
})
