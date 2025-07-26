console.log('Extension.js Monorepo Analytics Example content script loaded!')

// Example analytics functionality
let pageViews = 0

document.addEventListener('DOMContentLoaded', () => {
  pageViews++
  console.log(
    `Page view #${pageViews} tracked by Extension.js Monorepo Analytics Example`
  )

  // Store analytics data
  chrome.storage.local.set({pageViews})
})
