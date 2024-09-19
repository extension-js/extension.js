import './styles.css'

console.log('hello from content_scripts')

document.body.innerHTML += `
<div class="content_script-box">
  <img class="content_script-logo" src="${chrome.runtime.getURL('/logo.png')}" />
  <h1 class="content_script-title">
    Change the background-color ⬇
  </h1>
  <input type="color" class="content_script-colorPicker" id="colorPicker">
  <p class="content_script-description">
    Learn more about creating cross-browser extensions at <a
      className="underline hover:no-underline"
      href="https://extension.js.org"
      target="_blank"
    >
    https://extension.js.org
    </a>
  </p>
</div>
`

document.getElementById('colorPicker')?.addEventListener('input', (event) => {
  chrome.runtime
    .sendMessage({
      action: 'changeBackgroundColor',
      // @ts-expect-error
      color: event.target?.value
    })
    .catch(console.error)
})
