chrome.runtime.onInstalled.addListener(() => {
  console.log('🚀 Special Folders - Pages: Opening pages/main.html on startup')
  chrome.tabs.create({
    url: './pages/main.html'
  })
})
