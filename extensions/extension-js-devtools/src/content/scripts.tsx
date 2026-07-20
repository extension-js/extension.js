// ██████╗ ███████╗██╗   ██╗████████╗ ██████╗  ██████╗ ██╗     ███████╗
// ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
// ██║  ██║█████╗  ██║   ██║   ██║   ██║   ██║██║   ██║██║     ███████╗
// ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██║   ██║██║   ██║██║     ╚════██║
// ██████╔╝███████╗ ╚████╔╝    ██║   ╚██████╔╝╚██████╔╝███████╗███████║
// ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'
import './styles.css'

// Gate the entire overlay behind EXTENSION_PUBLIC_ERROR_OVERLAY: gating inside
// React still injected a host div on every page with the flag off.
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
  // Isolate the host from page styles (shadow DOM protects descendants only);
  // all:initial also wipes .extjs-overlay-host rules, so re-assert them inline.
  rootDiv.style.cssText =
    'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; isolation: isolate !important'
  document.body.appendChild(rootDiv)

  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  const styleElement = document.createElement('style')
  shadowRoot.appendChild(styleElement)
  fetchCSS().then((response) => (styleElement.textContent = response))

  const appRoot = document.createElement('div')
  appRoot.className = 'extjs-overlay-root'
  shadowRoot.appendChild(appRoot)

  // Radix DialogContent looks its title up in the LIGHT DOM only; shim
  // document.getElementById to fall through to our shadow root when it misses.
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
