import {mount} from 'svelte'
import sakuraCSS from 'sakura.css'
import ContentApp from './ContentApp.svelte'

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
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  // Load sakura.css into the shadow DOM
  const sakuraStyle = document.createElement('style')
  shadowRoot.appendChild(sakuraStyle)
  fetch(sakuraCSS as unknown as string)
    .then((response) => response.text())
    .then((text) => {
      sakuraStyle.textContent = text
    })

  const styleElement = document.createElement('style')
  shadowRoot.appendChild(styleElement)
  fetchCSS().then((response) => (styleElement.textContent = response))

  if (import.meta.webpackHot) {
    import.meta.webpackHot?.accept('./styles.css', () => {
      fetchCSS().then((response) => (styleElement.textContent = response))
    })
  }

  // Create container for Svelte app
  const contentDiv = document.createElement('div')
  contentDiv.className = 'content_script'
  shadowRoot.appendChild(contentDiv)

  // Mount Svelte app using Svelte 5's mount function
  mount(ContentApp, {
    target: contentDiv
  })

  return () => {
    rootDiv.remove()
  }
}

async function fetchCSS() {
  const cssUrl = new URL('./styles.css', import.meta.url)
  const response = await fetch(cssUrl)
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}
