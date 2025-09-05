// Extension.js content script template (React)
// - Export a default function (required in v3) that mounts your UI
// - Wrapper handles Shadow DOM isolation, CSS injection, HMR and cleanup
// - Avoid adding your own HMR code; dev warnings will be shown if detected
// Docs: https://extension.js.org/docs/content-scripts
import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'

export default function () {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const shadow = host.attachShadow({mode: 'open'})

  const style = document.createElement('style')
  shadow.appendChild(style)
  fetchCSS().then((css) => (style.textContent = css))

  const container = document.createElement('div')
  shadow.appendChild(container)

  const root = ReactDOM.createRoot(container)
  root.render(<ContentApp />)

  return () => {
    root.unmount()
    host.remove()
  }
}

async function fetchCSS() {
  const url = new URL('./styles.css', import.meta.url)
  const res = await fetch(url)
  const css = await res.text()
  return res.ok ? css : Promise.reject(css)
}
