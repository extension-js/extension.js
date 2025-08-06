import {createExtensionsPageTab, handleFirstRun} from './define-initial-tab.js'
import {connect, disconnect, keepAlive} from './reload-service.js'

function bgGreen(str) {
  return `background: transparent; color: #0971fe; ${str}`
}
chrome.tabs.query({active: true}, async ([initialTab]) => {
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

  if (
    initialTab.url === 'chrome://newtab/' ||
    initialTab.url === 'chrome://welcome/'
  ) {
    await handleFirstRun()
  } else {
    createExtensionsPageTab(initialTab, 'chrome://extensions/')
  }
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
