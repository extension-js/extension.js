import {createApp} from 'vue'
import ContentApp from './ContentApp.vue'
import './styles.css'

function initial() {
  // Create a new div element and append it to the document's body
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  // Inject content_scripts inside a shadow DOM
  // to prevent conflicts with the host page's styles.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  if (process.env.EXTENSION_MODE === 'development') {
    // @ts-expect-error - Tell Extension.js to use the shadow root
    // as the root element for injecting styles.
    window.__EXTENSION_SHADOW_ROOT__ = shadowRoot
  }

  // Create a container inside the shadow DOM for the Vue app
  const shadowAppContainer = document.createElement('div')
  shadowAppContainer.className = 'content_script'
  shadowRoot.appendChild(shadowAppContainer)

  // Mount the Vue app to the container inside the shadow DOM
  const app = createApp(ContentApp)
  app.mount(shadowAppContainer)
}

// Initialize the app
setTimeout(initial, 1000)
