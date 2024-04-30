/* global chrome */
// Ideas here are adapted from
// https://github.com/jeremyben/webpack-firefox-extension-launcher
// Released under MIT license.

// Create a new tab and set it to background.
// We want the user-selected page to be active,
// not chrome://extensions.
function createFirefoxExtensionsTab(initialTab, url) {
  // Check if url tab is open
  browser.tabs.query({url: 'about:addons'}, (tabs) => {
    const extensionsTabExist = tabs.length > 0

    // Return if url exists
    if (extensionsTabExist) return

    // Create an inactive tab
    browser.tabs.create(
      {url, active: false},
      function setBackgroundTab(extensionsTab) {
        // Get current url tab and move it left.
        // This action auto-activates the tab
        browser.tabs.move(extensionsTab.id, {index: 0}, () => {
          // Get user-selected initial page tab and activate the right tab
          browser.tabs.update(initialTab.id, {active: true})
        })
      }
    )
  })
}

const __IS_FIRST_RUN__ = false

browser.tabs.query({active: true}, ([initialTab]) => {
  if (initialTab.url === 'chrome://newtab/') {
    browser.tabs.update({url: 'about:addons'})
    // WARN: This is generated at runtime by rewriteFirstRunVariable function.
    if (__IS_FIRST_RUN__) {
      setTimeout(() => {
        browser.tabs.create({url: 'welcome.html'})
      }, 1000)
    }
  } else {
    createFirefoxExtensionsTab(initialTab, 'about:addons')
  }
})
