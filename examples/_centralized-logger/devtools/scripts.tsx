try {
  chrome.devtools?.panels.create(
    'Extension Logs',
    'images/extension_48.png',
    'sidebar/index.html'
  )
} catch {}
