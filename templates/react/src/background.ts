console.log('Hello from the background script')

const envBrowser = import.meta.env.EXTENSION_PUBLIC_BROWSER
const isFirefoxLike =
  envBrowser === 'firefox' ||
  envBrowser === 'gecko-based' ||
  /Firefox/i.test(navigator.userAgent)

if (isFirefoxLike) {
  const firefoxRuntime = (
    typeof browser !== 'undefined' && browser.runtime
      ? browser.runtime
      : chrome.runtime
  ) as typeof chrome.runtime
  const firefoxBrowserAction =
    typeof browser !== 'undefined' && browser.browserAction
      ? browser.browserAction
      : (chrome as any).browserAction
  const firefoxSidebarAction =
    typeof browser !== 'undefined' && browser.sidebarAction
      ? browser.sidebarAction
      : (chrome as any).sidebarAction

  if (firefoxBrowserAction?.onClicked) {
    firefoxBrowserAction.onClicked.addListener(() => {
      firefoxSidebarAction?.open()
    })
  }
}

if (!isFirefoxLike) {
  chrome.action.onClicked.addListener(() => {
    chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
  })

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'openSidebar') return

    chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})

    if (!chrome.sidePanel.open) return

    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const activeTabId = tabs && tabs[0] && tabs[0].id
      if (!activeTabId) return

      try {
        chrome.sidePanel.open({tabId: activeTabId})
      } catch (error) {
        console.error(error)
      }
    })
  })
}
