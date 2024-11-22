import {contentComponent} from './contentComponent.mjs'
import './styles.css'

console.log('hello from content_scripts')

setTimeout(initial, 1000)

function initial() {
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  if (process.env.EXTENSION_MODE === 'development') {
    // Use the shadow root as the root element to inject styles into.
    window.__EXTENSION_SHADOW_ROOT__ = shadowRoot
  }

  shadowRoot.innerHTML = contentComponent
}
