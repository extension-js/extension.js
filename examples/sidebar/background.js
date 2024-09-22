if (
  process.env.EXTENSION_PUBLIC_BROWSER === 'firefox' ||
  process.env.EXTENSION_PUBLIC_BROWSER === 'gecko-based'
) {
  // Firefox (Gecko-based browsers)
  browser.browserAction.onClicked.addListener(() => {
    // Opening the sidebar in Firefox
    browser.sidebarAction.open()
  })
} else {
  // Chromium-based browsers
  chrome.action.onClicked.addListener(() => {
    chrome.sidePanel.setOptions({
      path: 'side_panel/default_path.html',
      enabled: true
    })
  })
}
