import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'
// Import CSS directly - webpack will handle it as a string
import styles from './styles.css'

let unmount: () => void

if (import.meta.webpackHot) {
  import.meta.webpackHot?.accept()
  import.meta.webpackHot?.dispose(() => unmount?.())
}

if (document.readyState === 'complete') {
  unmount = initial() || (() => {})
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') unmount = initial() || (() => {})
  })
}

console.log('Hello from content script')

function initial() {
  // Create a new div element and append it to the document's body
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  // Create and inject style element with our CSS
  const style = document.createElement('style')
  style.textContent = styles 
  shadowRoot.appendChild(style)

  if (import.meta.webpackHot) {
    import.meta.webpackHot?.accept('./styles.css', () => {
      import('./styles.css').then(newStyles => {
        style.textContent = newStyles.default
      })
    })
  }

  const mountingPoint = ReactDOM.createRoot(shadowRoot)
  mountingPoint.render(
    <div className="content_script">
      <ContentApp />
    </div>
  )
  return () => {
    mountingPoint.unmount()
    rootDiv.remove()
    console.clear()
  }
}
