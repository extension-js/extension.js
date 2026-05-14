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

  // Radix `DialogContent` verifies that `DialogTitle` rendered by calling
  // `document.getElementById(titleId)` from a useEffect. That call is
  // hard-coded against the LIGHT DOM, so when the dialog is portalled into
  // our shadow root (as it is here) Radix can't find the title element and
  // logs `DialogContent requires a DialogTitle for the component to be
  // accessible for screen reader users.` even though a `DialogTitle` IS
  // rendered as a direct child of the content. Shim `document.getElementById`
  // to fall back through our shadow root so Radix's check passes; host-page
  // calls still get the original behavior because we only fall through when
  // the light-DOM lookup misses.
  if (!(document as any).__extjsDevtoolsGetByIdShimmed) {
    const originalGetById = document.getElementById.bind(document)
    ;(document as any).getElementById = function patchedGetElementById(
      id: string
    ) {
      const fromLight = originalGetById(id)
      if (fromLight) return fromLight
      try {
        return (
          (shadowRoot.querySelector(`#${CSS.escape(String(id))}`) as
            | HTMLElement
            | null) || null
        )
      } catch {
        return null
      }
    }
    ;(document as any).__extjsDevtoolsGetByIdShimmed = true
  }

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
