import {contentComponent} from './contentComponent.mjs'
import './styles.css'

console.log('hello from content_scripts')

document.body.innerHTML += contentComponent

document.getElementById('colorPicker').addEventListener('input', (event) => {
  chrome.runtime
    .sendMessage({
      action: 'changeBackgroundColor',
      color: event.target.value
    })
    .catch(console.error)
})
