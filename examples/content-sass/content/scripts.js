import logo from '../images/logo.svg'
import styles from './styles.scss'

let unmount

if (import.meta.webpackHot) {
  import.meta.webpackHot?.accept()
  import.meta.webpackHot?.dispose(() => unmount?.())
}

console.log('hello from content_scripts...', styles)

if (document.readyState === 'complete') {
  unmount = initial() || (() => {})
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') unmount = initial() || (() => {})
  })
}

function initial() {
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})
  const style = new CSSStyleSheet()
  shadowRoot.adoptedStyleSheets = [style]

  // Fetch and apply CSS styles
  fetchCssStyles().then((response) => style.replace(response))

  // Create container div
  const contentDiv = document.createElement('div')
  contentDiv.className = styles.content_script

  // Create and append logo image
  const img = document.createElement('img')
  img.className = styles.logo
  img.src = logo
  contentDiv.appendChild(img)

  // Create and append title
  const title = document.createElement('h1')
  title.className = styles.content_title
  title.textContent = 'Welcome to your SASS Extension'
  contentDiv.appendChild(title)

  // Create and append description paragraph
  const desc = document.createElement('p')
  desc.className = styles.content_description
  desc.innerHTML = 'Learn more about creating cross-browser extensions at '

  const link = document.createElement('a')
  link.href = 'https://extension.js.org'
  link.target = '_blank'
  link.textContent = 'https://extension.js.org'

  desc.appendChild(link)
  contentDiv.appendChild(desc)

  // Append the content div to shadow root
  shadowRoot.appendChild(contentDiv)

  return () => {
    rootDiv.remove()
  }
}

// IMPORTANT: Hot reloading of SASS files is not supported.
// You need to reload the current tab to see the changes.
async function fetchCssStyles() {
  // Using URL constructor to get the resolved path of the SASS file
  const sassUrl = new URL('./styles.scss', import.meta.url)
  const response = await fetch(sassUrl)
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}
