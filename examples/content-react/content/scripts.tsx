import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'

let unmount: () => void
// @ts-expect-error - global reference.
import.meta.webpackHot?.accept()
// @ts-expect-error - global reference.
import.meta.webpackHot?.dispose(() => unmount?.())

if (document.readyState === 'complete') {
  unmount = initial() || (() => {})
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') unmount = initial() || (() => {})
  })
}

console.log('Extension running...')

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

  // This needs to be inside initial() since it references the style element
  // that is created and used within this function's scope
  // @ts-expect-error - global reference.
  import.meta.webpackHot?.accept('./styles.css', () => {
    fetchCSS().then((response) => {
      style.textContent = response
    })
  })

  const mountingPoint = ReactDOM.createRoot(shadowRoot)
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
  const response = await fetch(new URL('./styles.css', import.meta.url))
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}
