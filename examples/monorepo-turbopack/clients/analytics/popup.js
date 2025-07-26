// Popup script for analytics extension
document.addEventListener('DOMContentLoaded', () => {
  // Get page views from storage
  chrome.storage.local.get(['pageViews'], (result) => {
    const pageViews = result.pageViews || 0
    document.getElementById('pageViews').textContent = pageViews
  })
})
