// Extension.js content script template (Preact)
// - Export a default function (required in v3) that mounts your UI
// - Wrapper handles Shadow DOM isolation, CSS injection, HMR and cleanup
// - Avoid adding your own HMR code; dev warnings will be shown if detected
// Docs: https://extension.js.org/docs/content-scripts
import {render} from 'preact'
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

  render(<ContentApp />, container)

  return () => {
    render(null, container)
    host.remove()
  }
}

async function fetchCSS() {
  const url = new URL('./styles.css', import.meta.url)
  const res = await fetch(url)
  const css = await res.text()
  return res.ok ? css : Promise.reject(css)
}
