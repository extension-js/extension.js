console.log(
  '[From the background context] Hello from the background worker/script!'
)

const isFirefoxLike =
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'gecko-based'

if (isFirefoxLike) {
  browser.browserAction.onClicked.addListener(() => {
    browser.sidebarAction.open()
  })

  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'openSidebar') return

    browser.sidebarAction.open()
  })
}

if (!isFirefoxLike) {
  // setPanelBehavior only affects FUTURE action clicks — registering it
  // inside onClicked would swallow the first toolbar click.
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
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
