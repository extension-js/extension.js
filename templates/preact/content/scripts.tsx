// Extension.js content script template (Preact)
// - Export a default function (required in v3) that mounts your UI
// - Wrapper handles Shadow DOM isolation, CSS injection, HMR and cleanup
// - Avoid adding your own HMR code; dev warnings will be shown if detected
// Docs: https://extension.js.org/docs/content-scripts
import {render} from 'preact'
import ContentApp from './ContentApp'

export default function () {
  // Create a new div element and append it to the document's body
  const rootDiv = document.createElement('div')
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  const styleElement = document.createElement('style')
  shadowRoot.appendChild(styleElement)
  fetchCSS().then((response) => (styleElement.textContent = response))

  // Create container for Preact app
  const container = document.createElement('div')
  container.className = 'content_script'
  shadowRoot.appendChild(container)

  render(<ContentApp />, container)

  return () => {
    rootDiv.remove()
  }
}

async function fetchCSS() {
  const url = new URL('./styles.css', import.meta.url)
  const res = await fetch(url)
  const css = await res.text()
  return res.ok ? css : Promise.reject(css)
}
