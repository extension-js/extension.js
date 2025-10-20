import {createExtensionsPageTab, handleFirstRun} from './define-initial-tab'

function bgGreen(str: string) {
  return `background: transparent; color: #0971fe; ${str}`
}

export async function initManagerUI() {
  try {
    chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
      const initialTab = Array.isArray(tabs) ? tabs[0] : undefined
      // @ts-ignore
      const isFirefox = import.meta.env.EXTENSION_BROWSER === 'firefox'
      const newTabUrl = isFirefox ? 'about:home' : 'chrome://newtab/'
      const welcomeUrl = isFirefox ? 'about:welcome' : 'chrome://welcome/'
      const extensionsPage = isFirefox ? 'about:addons' : 'chrome://extensions/'

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

      if (initialTab.url === newTabUrl || initialTab.url === welcomeUrl) {
        await handleFirstRun()
      } else {
        createExtensionsPageTab(initialTab, extensionsPage)
      }
    })
  } catch {}
}
