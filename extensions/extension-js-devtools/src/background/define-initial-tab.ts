// ██████╗ ███████╗██╗   ██╗████████╗ ██████╗  ██████╗ ██╗     ███████╗
// ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
// ██║  ██║█████╗  ██║   ██║   ██║   ██║   ██║██║   ██║██║     ███████╗
// ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██║   ██║██║   ██║██║     ╚════██║
// ██████╔╝███████╗ ╚████╔╝    ██║   ╚██████╔╝╚██████╔╝███████╗███████║
// ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {sessionBrowser} from './session-flags'
import {decideRepoint, isStartPage} from './start-pages'

export async function getDevExtensions() {
  try {
    if (!chrome.management.getAll) return []

    const allExtensions = (await new Promise((resolve) => {
      chrome.management.getAll(resolve)
    })) as chrome.management.ExtensionInfo[]

    const isBuiltIn = (extension: chrome.management.ExtensionInfo) => {
      const name = String(extension.name || '').toLowerCase()

      return name.includes('extension.js theme')
    }

    const devExtensions = (allExtensions || []).filter((extension) => {
      return (
        extension.id !== chrome.runtime.id &&
        extension.installType === 'development' &&
        // Exclude themes so we pick the actual user extension
        // (Chrome reports themes via management API)
        extension.type !== 'theme' &&
        extension.enabled === true &&
        !isBuiltIn(extension)
      )
    })

    return devExtensions
  } catch {
    return []
  }
}

export async function getDevExtension() {
  const devExtensions = await getDevExtensions()

  // Prefer the last registered dev extension (user extension appended last)
  return devExtensions[devExtensions.length - 1]
}

// Longer than the CLI's developer mode check can keep its tab open.
const EXTENSIONS_TAB_WATCH_MS = 30000

// Adapted from https://github.com/jeremyben/webpack-chrome-extension-launcher
// (MIT license).

// Create a new tab and set it to background: the user-selected page should be
// active, not chrome://extensions.
export function createExtensionsPageTab(initialTab: chrome.tabs.Tab) {
  const browser = sessionBrowser()
  const isFirefox = browser === 'firefox'
  const isEdge = browser === 'edge'
  const scheme = isFirefox ? 'about' : isEdge ? 'edge' : 'chrome'
  const extensionsPage = isFirefox ? 'about:addons' : `${scheme}://extensions/`

  const open = () => {
    chrome.tabs.create(
      {url: extensionsPage, active: false},
      function setBackgroundTab(extensionsTab) {
        if (typeof extensionsTab?.id !== 'number') return

        // Get current url tab and move it left.
        // This action auto-activates the tab
        chrome.tabs.move(extensionsTab.id, {index: 0}, () => {
          setTimeout(() => {
            chrome.tabs.update(initialTab.id, {active: true})
          }, 500)
        })
      }
    )
  }

  chrome.tabs.query({url: extensionsPage}, (tabs) => {
    const found = (Array.isArray(tabs) ? tabs : [])
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number')

    if (found.length === 0) {
      open()

      return
    }

    // The CLI opens this page for a moment to switch developer mode on, then
    // closes it. A tab found here can be that one, so its closing is watched.
    const onRemoved = (removedId: number) => {
      if (!found.includes(removedId)) return

      chrome.tabs.query({url: extensionsPage}, (left) => {
        if (Array.isArray(left) && left.length > 0) return

        chrome.tabs.onRemoved.removeListener(onRemoved)
        open()
      })
    }

    chrome.tabs.onRemoved.addListener(onRemoved)
    setTimeout(
      () => chrome.tabs.onRemoved.removeListener(onRemoved),
      EXTENSIONS_TAB_WATCH_MS
    )
  })
}

function repointTab(tabId: number, url: string, browser?: string) {
  let attempts = 0

  const onUpdated = (
    id: number,
    change: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ) => {
    const decision = decideRepoint({
      tabId,
      updatedTabId: id,
      status: change.status,
      url: tab.url,
      targetUrl: url,
      attempts,
      browser
    })

    if (decision === 'wait') return

    if (decision === 'stop') {
      chrome.tabs.onUpdated.removeListener(onUpdated)

      return
    }

    attempts += 1
    chrome.tabs.update(tabId, {url})
  }

  chrome.tabs.onUpdated.addListener(onUpdated)
  setTimeout(() => chrome.tabs.onUpdated.removeListener(onUpdated), 10000)
  chrome.tabs.update(tabId, {url})
}

// Chromium pins its launch warnings to the tab it starts with, such as the
// unsupported flag bar, so that tab is replaced instead of reused.
function swapStartTab(tabId: number, url?: string, browser?: string) {
  const reuse = () => {
    if (url) repointTab(tabId, url, browser)
  }

  try {
    chrome.tabs.create(
      url ? {url, active: false, index: 0} : {active: true, index: 0},
      (created) => {
        if (chrome.runtime.lastError || typeof created?.id !== 'number') {
          reuse()

          return
        }

        // Another tool may have taken the start tab since it was checked.
        chrome.tabs.get(tabId, (current) => {
          if (chrome.runtime.lastError || !current) return

          const at = String(current.url || current.pendingUrl || '')

          if (at && !isStartPage(at, browser)) return

          chrome.tabs.remove(tabId, () => void chrome.runtime.lastError)
        })
      }
    )
  } catch {
    reuse()
  }
}

export type FirstRunOptions = {
  // The CLI is about to load a starting URL into the launch tab, so the
  // welcome page opens without taking the window.
  welcomeBehind?: boolean
}

export async function handleFirstRun(
  startTab?: chrome.tabs.Tab,
  options: FirstRunOptions = {}
) {
  const browser = sessionBrowser()
  const isFirefox = browser === 'firefox'
  const isEdge = browser === 'edge'
  const scheme = isFirefox ? 'about' : isEdge ? 'edge' : 'chrome'
  const extensionsPage = isFirefox ? 'about:addons' : `${scheme}://extensions/`

  // Only the start tab the caller checked is ours to repoint. A second look at
  // the active tab can land on a page another tool opened in the meantime.
  const startTabId = typeof startTab?.id === 'number' ? startTab.id : undefined

  const devExtension = await getDevExtension()

  const browserStr = String(browser || 'chromium').toLowerCase()
  const storageKey = devExtension?.id || `__first_run__:${browserStr}`

  chrome.storage.local.get(storageKey, async (result) => {
    const stored = result?.[storageKey] as {didRun?: boolean} | undefined

    if (stored?.didRun) {
      // No welcome page on a later run, and the start tab still carries
      // the launch warnings, so a clean new tab takes its place.
      if (!isFirefox && typeof startTabId === 'number') {
        swapStartTab(startTabId, undefined, browser)
      }

      return
    }

    // Promise-wrap chrome.tabs.create so the welcome tab is confirmed open before
    // didRun commits; Firefox MV2 callbacks can silently never resolve.
    const createTab = (createProperties: chrome.tabs.CreateProperties) =>
      new Promise<chrome.tabs.Tab | undefined>((resolve) => {
        try {
          // Chrome's callback form returns void; Firefox returns a Promise.
          const ret = chrome.tabs.create(createProperties, (tab) => {
            if (chrome.runtime.lastError) {
              console.error(
                'Error creating tab:',
                chrome.runtime.lastError.message
              )

              resolve(undefined)

              return
            }

            resolve(tab)
          }) as unknown as Promise<chrome.tabs.Tab> | undefined

          if (ret && typeof ret.then === 'function') {
            ret.then(resolve, () => resolve(undefined))
          }
        } catch (error) {
          console.error('Error creating tab:', error)
          resolve(undefined)
        }
      })

    let opened: chrome.tabs.Tab | undefined

    try {
      const welcomeUrl = chrome.runtime.getURL('pages/welcome.html')

      if (isFirefox) {
        opened = await createTab({
          url: welcomeUrl,
          active: !options.welcomeBehind
        })

        // Ensure the addons manager exists in the background for convenience.
        // Best-effort: not gated on the welcome tab guard.
        try {
          chrome.tabs.query({url: 'about:addons'}, (xtabs) => {
            if (!Array.isArray(xtabs) || xtabs.length === 0) {
              void createTab({url: 'about:addons', active: false})
            }
          })
        } catch {
          console.error('Error querying addons tab')
        }
      } else {
        opened = await createTab({url: welcomeUrl, active: true})

        // The extensions page opens behind the welcome page, in a new tab
        // that replaces the start tab.
        if (typeof startTabId === 'number') {
          swapStartTab(startTabId, extensionsPage, browser)
        }
      }
    } catch {
      opened = await createTab({url: 'pages/welcome.html', active: true})
    }

    // Only commit didRun after the welcome tab is confirmed open. If the
    // creation failed, leave didRun unset so the next install/startup retries
    if (opened) {
      chrome.storage.local.set({[storageKey]: {didRun: true}})
    }
  })
}
