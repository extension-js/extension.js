document.getElementById('colorPicker').addEventListener('input', function (e) {
  chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
    chrome.scripting
      .executeScript({
        target: {tabId: tabs[0].id},
        function: setPageBackgroundColor,
        args: [e.target.value]
      })
      .catch((err) => {
        console.log(err)
      })
  })
})

function setPageBackgroundColor(color) {
  document.body.style.backgroundColor = color
}
