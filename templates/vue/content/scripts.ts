// Extension.js content script template (Vue)
// - Export a default function (required in v3) that mounts your UI
// - Wrapper handles Shadow DOM isolation, CSS injection, HMR and cleanup
// - Avoid adding your own HMR code; dev warnings will be shown if detected
// Docs: https://extension.js.org/docs/content-scripts
import {createApp} from 'vue'
import ContentApp from './ContentApp.vue'

console.log('Hello from content script')

export default function initial(host?: HTMLElement) {
  // If wrapper provides a host container inside a ShadowRoot, render into it.
  // Otherwise, operate in standalone mode and create our own shadow root.
  let cleanup: (() => void) | undefined

  if (host) {
    const rootNode = host.getRootNode?.()
    const shadowRoot =
      rootNode && rootNode instanceof ShadowRoot
        ? (rootNode as ShadowRoot)
        : undefined

    // Inject CSS into the existing shadow root if available
    if (shadowRoot) {
      const styleElement = document.createElement('style')
      shadowRoot.appendChild(styleElement)
      fetchCSS().then((response) => (styleElement.textContent = response))
    }

    // Ensure a mount container exists (host itself is fine)
    const app = createApp(ContentApp)
    app.mount(host)
    cleanup = () => {
      try {
        app.unmount()
      } catch {}
    }
  } else {
    const rootDiv = document.createElement('div')
    document.body.appendChild(rootDiv)

    // Standalone: create shadow root and inject CSS locally
    const shadowRoot = rootDiv.attachShadow({mode: 'open'})
    const styleElement = document.createElement('style')
    shadowRoot.appendChild(styleElement)
    fetchCSS().then((response) => (styleElement.textContent = response))

    const contentDiv = document.createElement('div')
    contentDiv.className = 'content_script'
    shadowRoot.appendChild(contentDiv)

    const app = createApp(ContentApp)
    app.mount(contentDiv)
    cleanup = () => {
      try {
        app.unmount()
      } catch {}
      try {
        rootDiv.remove()
      } catch {}
    }
  }

  return cleanup
}

async function fetchCSS() {
  const cssUrl = new URL('./styles2.css', import.meta.url)
  const response = await fetch(cssUrl)
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}
