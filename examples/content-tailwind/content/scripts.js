import './styles.css'
import {getContentHtml} from './content'

console.log('hello from content_scripts')

if (document.readyState === 'complete') {
  initial()
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') initial()
  })
}

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

  shadowRoot.innerHTML = `
    <div class="content_script">
      ${getContentHtml()}
    </div>
  `
}
