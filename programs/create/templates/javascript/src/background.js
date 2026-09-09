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
  // setPanelBehavior only affects FUTURE action clicks, registering it
  // inside onClicked would swallow the first toolbar click.
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'openSidebar') return

  // Every line here runs synchronously on purpose. sidePanel.open() is only
  // allowed inside the user gesture that the content-script click carries, and
  // a tabs.query callback outlives it: the panel then silently refuses to open.
  // sender.tab is the tab the click came from, so no lookup is needed at all.
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})

  const tabId = sender.tab?.id
  if (!chrome.sidePanel.open || tabId === undefined) return

  try {
    chrome.sidePanel.open({tabId})
  } catch (error) {
    console.error(error)
  }
})
