import {createExtensionsPageTab, handleFirstRun} from './define-initial-tab'

function bgGreen(str: string) {
  return `background: transparent; color: #0971fe; ${str}`
}

export async function initManagerUI() {
  try {
    chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
      const initialTab = Array.isArray(tabs) ? tabs[0] : undefined
      // @ts-ignore
      const browser = (import.meta as any).env?.EXTENSION_BROWSER
      const isFirefox = browser === 'firefox'
      const isEdge = browser === 'edge'
      const scheme = isFirefox ? 'about' : isEdge ? 'edge' : 'chrome'
      const newTabUrl = isFirefox ? 'about:home' : `${scheme}://newtab/`
      const welcomeUrl = isFirefox ? 'about:welcome' : `${scheme}://welcome/`
      const extensionsPage = isFirefox
        ? 'about:addons'
        : `${scheme}://extensions/`

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
        try {
          await handleFirstRun()
        } catch {
          try {
            chrome.tabs.create({url: extensionsPage})
          } catch {}
        }
        return
      }

      const url = String(initialTab.url || '')
      const isInitialPage = isFirefox
        ? url === 'about:home' || url === 'about:welcome'
        : url.startsWith(`${scheme}://newtab`) ||
          url.startsWith(`${scheme}://welcome`)
      if (isInitialPage) {
        await handleFirstRun()
      } else {
        createExtensionsPageTab(initialTab, extensionsPage)
      }
    })
  } catch {}
}
