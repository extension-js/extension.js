import logo from '../images/logo.svg'
// Import SASS module file to ensure webpack processes it as an asset
import './styles.module.scss'

let unmount

console.log('hello from content_scripts')

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

  // Fetch and apply SCSS styles
  fetchSassStyles().then((response) => style.replace(response))

  // Create container div
  const contentDiv = document.createElement('div')
  contentDiv.className = 'content_script'

  // Create and append logo image
  const img = document.createElement('img')
  img.className = 'content_logo'
  img.src = logo
  contentDiv.appendChild(img)

  // Create and append title
  const title = document.createElement('h1')
  title.className = 'content_title'
  title.textContent = 'Welcome to your Sass Modules Extension'
  contentDiv.appendChild(title)

  // Create and append description paragraph
  const desc = document.createElement('p')
  desc.className = 'content_description'
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

async function fetchSassStyles() {
  // Fetch the compiled CSS file from the SASS module
  const cssUrl = new URL('./styles.module.scss', import.meta.url)
  console.log('🔍 Fetching SASS module CSS from:', cssUrl.href)

  const response = await fetch(cssUrl)
  console.log('🔍 Response status:', response.status)
  console.log('🔍 Response ok:', response.ok)

  const text = await response.text()
  console.log('🔍 CSS content length:', text.length)
  console.log('🔍 CSS content preview:', text.substring(0, 100))

  return response.ok ? text : Promise.reject(text)
}
