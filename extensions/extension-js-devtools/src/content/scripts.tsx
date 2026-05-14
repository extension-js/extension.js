import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'
import './styles.css'

// Gate the entire overlay (shadow-DOM injection + React mount) behind the
// EXTENSION_PUBLIC_ERROR_OVERLAY flag. The previous gate lived inside the
// React component, which still left a `<div data-extension-root>` injected
// on every page even when the overlay was disabled — surprising users who
// had toggled the flag off.
const isErrorOverlayEnabled =
  String((import.meta as any).env?.EXTENSION_PUBLIC_ERROR_OVERLAY || '')
    .trim()
    .toLowerCase() === 'true'

export default function initial() {
  if (!isErrorOverlayEnabled) {
    return () => {}
  }
  const existingRoot = document.querySelector(
    '[data-extension-root="extension-js-devtools"]'
  ) as HTMLElement | null
  if (existingRoot) {
    existingRoot.remove()
  }

  const rootDiv = document.createElement('div')
  rootDiv.setAttribute('data-extension-root', 'extension-js-devtools')
  rootDiv.className = 'extjs-overlay-host'
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  const styleElement = document.createElement('style')
  shadowRoot.appendChild(styleElement)
  fetchCSS().then((response) => (styleElement.textContent = response))

  // Create a container for React to render into
  const appRoot = document.createElement('div')
  appRoot.className = 'extjs-overlay-root'
  shadowRoot.appendChild(appRoot)

  const mountingPoint = ReactDOM.createRoot(appRoot)
  mountingPoint.render(
    <div className="content_script">
      <ContentApp portalContainer={shadowRoot} />
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
