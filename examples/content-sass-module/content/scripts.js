import './styles.scss'
import styles from './Logo.module.scss'

console.log('hello from content_scripts')

document.body.innerHTML += `
<div class="content_script-box">
  <img class=${styles.logo} src="/logo.svg" />
  <h1 class="content_script-title">
    Change the background-color ⬇
  </h1>
  <input type="color" class="content_script-colorPicker" id="colorPicker">
  <p class="content_script-description">
    Learn more about creating browser extensions at <a
      className="underline hover:no-underline"
      href="https://extension.js.org"
      target="_blank"
    >
    https://extension.js.org
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
