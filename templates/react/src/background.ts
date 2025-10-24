console.log('Hello from the background script')

const isFirefoxLike =
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'gecko-based'

if (isFirefoxLike) {
  browser.browserAction.onClicked.addListener(() => {
    browser.sidebarAction.open()
  })

  browser.runtime.onMessage.addListener((message: any) => {
    if (!message || message.type !== 'openSidebar') return

    browser.sidebarAction.open()
  })
}

if (!isFirefoxLike) {
  chrome.action.onClicked.addListener(() => {
    chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
  })
}

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
