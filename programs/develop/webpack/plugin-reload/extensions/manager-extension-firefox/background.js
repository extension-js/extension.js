import {createFirefoxAddonsTab, handleFirstRun} from './define-initial-tab.js'
import {connect, disconnect} from './reload-service.js'

function bgGreen(str) {
  return `background: #0A0C10; color: #26FFB8; ${str}`
}

async function handleTabOnExtensionLoad() {
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
`,
    bgGreen('')
  )

  try {
    const [initialTab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    })

    if (
      initialTab.url === 'about:blank' ||
      initialTab.url === 'about:welcome'
    ) {
      await handleFirstRun()
    } else {
      await createFirefoxAddonsTab(initialTab, 'about:blank')
    }
  } catch (error) {
    console.error('Error handling tabs on extension load:', error)
  }
}

handleTabOnExtensionLoad().catch(console.error)

browser.runtime.onInstalled.addListener(async () => {
  let isConnected = false

  if (isConnected) {
    disconnect()
  } else {
    await connect()
    isConnected = true
  }
})
