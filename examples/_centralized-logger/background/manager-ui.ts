import {createExtensionsPageTab, handleFirstRun} from './define-initial-tab'

function bgGreen(str: string) {
  return `background: transparent; color: #0971fe; ${str}`
}

export async function initManagerUI() {
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
        try {
          await handleFirstRun()
        } catch {
          try {
            chrome.tabs.create({url: 'chrome://extensions/'})
          } catch {}
        }
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
}
