// ██████╗ ███████╗██╗   ██╗████████╗ ██████╗  ██████╗ ██╗     ███████╗
// ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
// ██║  ██║█████╗  ██║   ██║   ██║   ██║   ██║██║   ██║██║     ███████╗
// ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██║   ██║██║   ██║██║     ╚════██║
// ██████╔╝███████╗ ╚████╔╝    ██║   ╚██████╔╝╚██████╔╝███████╗███████║
// ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createExtensionsPageTab, handleFirstRun} from './define-initial-tab'
import {readSessionFlags, sessionBrowser} from './session-flags'
import {isStartPage} from './start-pages'

function bgGreen(str: string) {
  return `background: transparent; color: #0065e6; ${str}`
}

const URL_WAIT_STEP_MS = 100
const URL_WAIT_STEPS = 20

// pendingUrl is what a tab still loading at startup carries.
const tabUrl = (tab?: chrome.tabs.Tab) =>
  String(tab?.url || tab?.pendingUrl || '')

// A tab read in the first moments of a launch can report no url at all,
// which says nothing about where it is, so it is read again until it does.
async function settledTabUrl(tab: chrome.tabs.Tab): Promise<string> {
  let url = tabUrl(tab)

  for (let step = 0; !url && step < URL_WAIT_STEPS; step++) {
    if (typeof tab.id !== 'number') break

    await new Promise((resolve) => setTimeout(resolve, URL_WAIT_STEP_MS))

    const current = await new Promise<chrome.tabs.Tab | undefined>(
      (resolve) => {
        try {
          chrome.tabs.get(tab.id as number, (found) => {
            resolve(chrome.runtime.lastError ? undefined : found)
          })
        } catch {
          resolve(undefined)
        }
      }
    )

    if (!current) break

    url = tabUrl(current)
  }

  return url
}

export async function initManagerUI() {
  // --no-open means no tab at all. The CLI says so through a flag file in the
  // per-session copy it stages, read here before any tab is created.
  const session = await readSessionFlags()
  if (session.noOpen) return

  try {
    chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
      const initialTab = Array.isArray(tabs) ? tabs[0] : undefined
      const browser = sessionBrowser()
      const isFirefox = browser === 'firefox'
      const isEdge = browser === 'edge'
      const scheme = isFirefox ? 'about' : isEdge ? 'edge' : 'chrome'
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
MIT (c) ${new Date().getFullYear()} - Cezar Augusto and the Extension.js authors.
`,
        bgGreen('')
      )

      if (!initialTab) {
        try {
          await handleFirstRun(undefined, {welcomeBehind: session.startingUrl})
        } catch {
          try {
            chrome.tabs.create({url: extensionsPage})
          } catch {
            // Ignore
          }
        }

        return
      }

      const url = await settledTabUrl(initialTab)
      const isInitialPage = isStartPage(url, browser)

      // Firefox does not always start on an initial page, so first-run
      // handling always runs there to keep the welcome page reachable.
      if (isFirefox) {
        await handleFirstRun(undefined, {welcomeBehind: session.startingUrl})

        if (!isInitialPage) {
          createExtensionsPageTab(initialTab)
        }

        return
      }

      if (isInitialPage) {
        await handleFirstRun(initialTab)

        return
      }

      createExtensionsPageTab(initialTab)
    })
  } catch {
    // Ignore
  }
}
