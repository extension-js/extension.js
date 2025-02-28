import './styles.css?inline_style'
import logo from '../images/logo.svg'

console.log('hello from content_scripts')

let unmount
import.meta.webpackHot.accept()
import.meta.webpackHot.dispose(() => unmount())

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

  // Inform Extension.js that the shadow root is available.
  // window.__EXTENSION_SHADOW_ROOT__ = shadowRoot

  const style = document.createElement('style')
  shadowRoot.appendChild(style)

  const contentDiv = document.createElement('div')
  contentDiv.className = 'content_script'

  const logoImg = document.createElement('img')
  logoImg.className = 'content_logo'
  logoImg.src = logo
  contentDiv.appendChild(logoImg)

  const title = document.createElement('h1')
  title.className = 'content_title'
  title.textContent = 'Welcome to your Content Script Extension'
  contentDiv.appendChild(title)

  const description = document.createElement('p')
  description.className = 'content_description'

  const text = document.createTextNode(
    'Learn more about creating cross-browser extensions at '
  )
  description.appendChild(text)

  const link = document.createElement('a')
  link.className = 'underline hover:no-underline'
  link.href = 'https://extension.js.org'
  link.target = '_blank'
  link.textContent = 'https://extension.js.org'

  description.appendChild(link)
  contentDiv.appendChild(description)

  shadowRoot.appendChild(contentDiv)

  // Handle CSS injection
  fetchCSS().then((response) => {
    style.textContent = response
  })

  import.meta.webpackHot?.accept('./styles.css', () => {
    fetchCSS().then((response) => {
      style.textContent = response
    })
  })

  return () => {
    rootDiv.remove()
  }
}

async function fetchCSS() {
  const response = await fetch(new URL('./styles.css', import.meta.url))
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}
