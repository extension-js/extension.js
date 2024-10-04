const isFirefoxLike =
  typeof browser !== 'undefined' && typeof browser.sidebarAction !== 'undefined'

if (isFirefoxLike) {
  browser.browserAction.onClicked.addListener(() => {
    browser.sidebarAction.open()
  })
} else if (typeof chrome !== 'undefined' && chrome.sidePanel) {
  chrome.action.onClicked.addListener(() => {
    chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
  })
}
