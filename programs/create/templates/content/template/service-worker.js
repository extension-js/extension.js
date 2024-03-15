chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'changeBackgroundColor') {
    changeBackgroundColor(request.color, sender.tab.id)
  }
})

function changeBackgroundColor(color, tabId) {
  chrome.scripting
    .executeScript({
      target: {tabId},
      function: setPageBackgroundColor,
      args: [color]
    })
    .catch(console.error)
}

function setPageBackgroundColor(color) {
  document.body.style.backgroundColor = color
}
