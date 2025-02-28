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

  const style = document.createElement('style')
  shadowRoot.appendChild(style)

  // Create content container div
  const contentDiv = document.createElement('div')
  contentDiv.className = 'content_script'
  shadowRoot.appendChild(contentDiv)

  // Create logo image
  const logoImg = document.createElement('img')
  logoImg.className = 'content_logo'
  logoImg.src = logo
  contentDiv.appendChild(logoImg)

  // Create title
  const title = document.createElement('h1')
  title.className = 'content_title'
  title.textContent = 'Welcome to your Sass Extension'
  contentDiv.appendChild(title)

  // Create description
  const description = document.createElement('p')
  description.className = 'content_description'
  description.innerHTML =
    'Learn more about creating cross-browser extensions at <a class="underline hover:no-underline" href="https://extension.js.org" target="_blank">https://extension.js.org</a>'
  contentDiv.appendChild(description)

  // Handle CSS injection
  fetchCSS().then((response) => {
    style.textContent = response
  })

  import.meta.webpackHot?.accept('./styles.scss', () => {
    fetchCSS().then((response) => {
      style.textContent = response
    })
  })

  return () => {
    rootDiv.remove()
  }
}

async function fetchCSS() {
  const response = await fetch(new URL('./styles.scss', import.meta.url))
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}
