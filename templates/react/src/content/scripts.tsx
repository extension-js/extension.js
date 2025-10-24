import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'
import './styles.css'

console.log('Hello from content script')

export default function initial() {
  // Create a new div element and append it to the document's body
  const rootDiv = document.createElement('div')
  rootDiv.setAttribute('data-extension-root', 'true')
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  const styleElement = document.createElement('style')
  shadowRoot.appendChild(styleElement)
  fetchCSS().then((response) => (styleElement.textContent = response))

  // Create a container for React to render into
  const container = document.createElement('div')
  shadowRoot.appendChild(container)

  const mountingPoint = ReactDOM.createRoot(container)
  mountingPoint.render(
    <div className="content_script">
      <ContentApp />
    </div>
  )
  return () => {
    mountingPoint.unmount()
    rootDiv.remove()
  }
}

async function fetchCSS() {
  const cssUrl = new URL('./styles.css', import.meta.url)
  const response = await fetch(cssUrl)
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}
