// import ReactDOM from 'react-dom/client'
// import ContentScript from './scripts'

let unmount: () => void
// @ts-expect-error - global reference.
import.meta.webpackHot?.accept()
// @ts-expect-error - global reference.
import.meta.webpackHot?.dispose(() => unmount?.())

if (document.readyState === 'complete') {
  unmount = getShadowRoot() || (() => {})
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete')
      unmount = getShadowRoot() || (() => {})
  })
}

async function fetchCSS(stylesheetPath: string) {
  // @ts-expect-error - global reference.
  const response = await fetch(new URL(stylesheetPath, import.meta.url))
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}

export function getShadowRoot(
  element?: string,
  id?: string,
  stylesheets?: string[],
//   jsx?: React.ReactNode
) {
  // Create a new div element and append it to the document's body
  const rootElement = document.createElement(element || 'div')
  rootElement.id = id || 'extension-root'
  document.body.appendChild(rootElement)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootElement.attachShadow({mode: 'open'})

  // Create an array to store style elements for hot reloading
  const styleElements: HTMLStyleElement[] = []

  // Create and append style elements for each stylesheet
  stylesheets?.forEach((stylesheet) => {
    const style = document.createElement('style')
    shadowRoot.appendChild(style)
    styleElements.push(style)
    fetchCSS(stylesheet).then((response) => {
      style.textContent = response
    })
  })

  // Set up hot reloading for each stylesheet
  stylesheets?.forEach((stylesheet, index) => {
    // @ts-expect-error - global reference.
    import.meta.webpackHot?.accept(stylesheet, () => {
      fetchCSS(stylesheet).then((response) => {
        if (styleElements[index]) {
          styleElements[index].textContent = response
        }
      })
    })
  })

//   const mountingPoint = ReactDOM.createRoot(shadowRoot)
//   mountingPoint.render(jsx)

  return () => {
    // mountingPoint.unmount()
    rootElement.remove()
  }
}

// Usage in a loader
// getShadowRoot('div', 'extension-root', ['./styles.css'], <ContentScript />)

// Sample user code

// ```tsx
// 'use shadow-dom'
// 
// import ContentApp from './ContentApp'
// // Any imported CSS files will be automatically
// // added the shadow DOM
// import './styles.css'
//
// // Create a root div element with id "'extension-root'"
// // and append it to the document's body. Note that
// // the default export is required for Extension.js to 
// // know what element to mount in the shadow root.
// export default function ContentScript() {
//   console.log('Extension running...')

//   return (
//     <div className="content_script">
//       <ContentApp />
//     </div>
//   )
// }
// ```
