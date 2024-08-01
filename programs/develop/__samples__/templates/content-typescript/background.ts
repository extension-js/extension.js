console.log('hello from background script')

// eslint-disable-next-line no-undef
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action === 'changeBackgroundColor') {
    changeBackgroundColor(request.color, sender.tab?.id)
  }
})

function changeBackgroundColor(color: string, tabId: number | undefined) {
  if (!tabId) {
    return
  }

  chrome.scripting
    .executeScript({
      target: {tabId},
      func: setPageBackgroundColor,
      args: [color]
    })
    .catch(console.error)
}

function setPageBackgroundColor(color: string) {
  document.body.style.backgroundColor = color
}
