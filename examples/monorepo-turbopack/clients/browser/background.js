console.log('Extension.js Monorepo Browser Example background script loaded!')

// Example background script functionality
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension.js Monorepo Browser Example installed')
})
