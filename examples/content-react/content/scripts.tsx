import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'
import {injectStyles} from './scripts-shell'
// import './styles.css?inline_style'
import './styles.css?inline_style'

if (document.readyState === 'complete') {
  initial()
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') initial()
  })
}

injectStyles()

export default function initial() {
  // Create a new div element and append it to the document's body
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  // Use the shadow root as the root element to inject styles into.
  window.__EXTENSION_SHADOW_ROOT__ = shadowRoot

  const root = ReactDOM.createRoot(shadowRoot)
  root.render(
    <div className="content_script">
      <ContentApp />
    </div>
  )

  return () => {
    root.unmount()
    // shadowRoot.remove()
  }
}
