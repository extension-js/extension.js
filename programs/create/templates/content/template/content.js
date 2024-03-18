import extensionCreateLogo from './images/extensioncreate.svg'
import('./content.css')

document.body.innerHTML += `
<div class="content_script-box">
  <img class="content_script-logo" src=${extensionCreateLogo} />
  <h1 class="content_script-title">
    Change the background-color ⬇
  </h1>
  <input type="color" class="content_script-colorPicker" id="colorPicker">
  <p class="content_script-description">
    Learn more about creating browser extensions at <a
      className="underline hover:no-underline"
      href="https://docs.extensioncreate.com"
      target="_blank"
    >
    https://docs.extensioncreate.com
    </a>
  </p>
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
