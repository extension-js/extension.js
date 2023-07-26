/* global chrome */
// Ideas here are adapted from
// https://github.com/jeremyben/webpack-chrome-extension-launcher
// Released under MIT license.

// Create a new tab and set it to background.
// We want the user-selected page to be active,
// not chrome://extensions.
function createChromeExtensionsTab(initialTab) {
  // Check if chrome://extensions tab is open
  chrome.tabs.query({url: 'chrome://extensions/'}, (tabs) => {
    const extensionsTabExist = tabs.length > 0

    // Return if chrome://extensions exists
    if (extensionsTabExist) return

    // Create an inactive tab
    chrome.tabs.create(
      {url: 'chrome://extensions/', active: false},
      function setBackgroundTab(extensionsTab) {
        // Get current chrome://extensions tab and move it left.
        // This action auto-activates the tab
        chrome.tabs.move(extensionsTab.id, {index: 0}, () => {
          // Get user-selected initial page tab and activate the right tab
          chrome.tabs.update(initialTab.id, {active: true})
        })
      }
    )
  })
}

chrome.tabs.query({active: true}, ([initialTab]) => {
  if (
    // initialTab.url === 'chrome://newtab/' ||
    initialTab.url === 'chrome://welcome/'
  ) {
    // Ensure this tab isn't open
    chrome.tabs.update({url: 'chrome://extensions/'})
  } else {
    createChromeExtensionsTab(initialTab)
  }
})
