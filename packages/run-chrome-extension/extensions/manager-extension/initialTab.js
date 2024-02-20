/* global chrome */
// Ideas here are adapted from
// https://github.com/jeremyben/webpack-chrome-extension-launcher
// Released under MIT license.

// Create a new tab and set it to background.
// We want the user-selected page to be active,
// not chrome://extensions.
function createChromeExtensionsTab(initialTab, url) {
  // Check if url tab is open
  chrome.tabs.query({url: 'chrome://extensions/'}, (tabs) => {
    const extensionsTabExist = tabs.length > 0

    // Return if url exists
    if (extensionsTabExist) return

    // Create an inactive tab
    chrome.tabs.create(
      {url, active: false},
      function setBackgroundTab(extensionsTab) {
        // Get current url tab and move it left.
        // This action auto-activates the tab
        chrome.tabs.move(extensionsTab.id, {index: 0}, () => {
          // Get user-selected initial page tab and activate the right tab
          chrome.tabs.update(initialTab.id, {active: true})
        })
      }
    )
  })
}

const __IS_FIRST_RUN__ = false

chrome.tabs.query({active: true}, ([initialTab]) => {
  if (initialTab.url === 'chrome://newtab/') {
    chrome.tabs.update({url: 'chrome://extensions/'})
    // WARN: This is generated at runtime by rewriteFirstRunVariable function.
    if (__IS_FIRST_RUN__) {
      chrome.tabs.create({url: 'welcome.html'})
    }
  } else {
    createChromeExtensionsTab(initialTab, 'chrome://extensions/')
  }
})
