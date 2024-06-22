import {createApp} from 'vue'
import ContentApp from './ContentApp.vue'
import './styles.css'

function initial() {
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  createApp(ContentApp).mount(rootDiv)
}

setTimeout(initial, 1000)
