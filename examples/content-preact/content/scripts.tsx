import {render} from 'preact'
import ContentApp from './ContentApp'

let unmount: () => void
import.meta.webpackHot?.accept()
import.meta.webpackHot?.dispose(() => unmount?.())

if (document.readyState === 'complete') {
  unmount = initial() || (() => {})
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') unmount = initial() || (() => {})
  })
}

function initial() {
  // Create a new div element and append it to the document's body
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  const style = document.createElement('style')
  shadowRoot.appendChild(style)

  fetchCSS().then((response) => {
    style.textContent = response
  })
  console.log('Running....???')

  import.meta.webpackHot?.accept('./styles.css', () => {
    fetchCSS().then((response) => {
      style.textContent = response
    })
  })

  // Preact specific rendering
  render(
    <div className="content_script">
      <ContentApp />
    </div>,
    shadowRoot
  )

  return () => {
    // Preact's render returns undefined, so we just remove the root
    rootDiv.remove()
  }
}

async function fetchCSS() {
  const response = await fetch(new URL('./styles.css', import.meta.url))
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}
