console.log('hello from background script')

chrome.runtime.onMessage.addListener((request, sender) => {
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
