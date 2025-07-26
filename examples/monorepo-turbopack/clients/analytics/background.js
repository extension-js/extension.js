console.log('Extension.js Monorepo Analytics Example background script loaded!')

// Example analytics background functionality
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension.js Monorepo Analytics Example installed')
  chrome.storage.local.set({pageViews: 0})
})
