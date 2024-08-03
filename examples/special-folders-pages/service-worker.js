chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.create({
    url: './pages/main.html'
  })
})
