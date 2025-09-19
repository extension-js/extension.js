try {
  chrome.devtools?.panels.create(
    'Extension Logs',
    'images/logo.png',
    // Refer to the output folder for the path
    'sidebar/index.html'
  )
} catch {
  console.error('[Extension.js] Failed to create devtools panel')
}
