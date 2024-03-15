import('./content.css')

document.body.innerHTML += `
<div class="box">
<h1 class="title">Change background ⬇</h1>
<input type="color" class="colorPicker" id="colorPicker">
</div>
`

document.getElementById('colorPicker').addEventListener('input', (event) => {
  chrome.runtime
    .sendMessage({
      action: 'changeBackgroundColor',
      color: event.target.value
    })
    .catch(console.error)
})
