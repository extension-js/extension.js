chrome.action.onClicked.addListener(() => {
  chrome.sidePanel.setOptions({
    path: 'side_panel/default_path.html',
    enabled: true
  })
})
