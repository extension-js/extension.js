import './base.css'
import './content.css'
import {createApp} from 'vue'
import ContentApp from './ContentApp.vue'

function initial() {
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  createApp(ContentApp).mount(rootDiv)
}

setTimeout(initial, 1000)
