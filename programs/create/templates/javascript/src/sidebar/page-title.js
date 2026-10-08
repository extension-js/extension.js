// The panel's question to the page. The content script answers it with the
// page title and url, so the panel never reads the page on its own.
export const PAGE_TITLE_REQUEST = 'getPageTitle'

function isWebPage(tab) {
  return typeof tab.url === 'string' && /^https?:/.test(tab.url)
}

// The page the panel is about. When the panel itself is open as a tab (Safari,
// or a test harness) the active tab is the panel, so the most recently used
// web tab stands in for it.
function findPageTab(callback) {
  chrome.tabs.query({active: true, lastFocusedWindow: true}, (focused) => {
    const current = focused?.[0]

    if (current && isWebPage(current)) {
      callback(current)

      return
    }

    chrome.tabs.query({}, (tabs) => {
      const webTabs = (tabs ?? []).filter(isWebPage)
      webTabs.sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)
      )

      callback(webTabs[0])
    })
  })
}

function askPage(tab, onAnswer) {
  chrome.tabs.sendMessage(tab.id, {type: PAGE_TITLE_REQUEST}, (answer) => {
    // A page with no content script in it (a browser page, or one loaded
    // before the extension was) has nobody to answer, so the hint stays up.
    onAnswer(chrome.runtime.lastError ? undefined : answer)
  })
}

// Keeps onChange fed with the current page's title, asking again whenever the
// active tab changes or a page finishes loading. Returns the function that
// stops watching.
export function watchPageTitle(onChange) {
  const refresh = () => {
    findPageTab((tab) => {
      if (!tab) {
        onChange(undefined)

        return
      }

      askPage(tab, onChange)
    })
  }

  const onUpdated = (_tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.title) refresh()
  }

  chrome.tabs.onActivated.addListener(refresh)
  chrome.tabs.onUpdated.addListener(onUpdated)
  refresh()

  return () => {
    chrome.tabs.onActivated.removeListener(refresh)
    chrome.tabs.onUpdated.removeListener(onUpdated)
  }
}
