import logo from '../images/logo.png'

const UNMOUNT_GLOBAL_KEY = '__EXTJS_CONTENT_UNMOUNT__'
// Use var so re-injection doesn't throw on redeclaration
// Also pick up any previous unmount function from the last injection
var unmount = (globalThis && globalThis[UNMOUNT_GLOBAL_KEY]) || undefined

console.log('hello from content_scripts')

if (document.readyState === 'complete') {
  // Clean up previous mount if any (e.g., re-injection)
  try {
    typeof unmount === 'function' && unmount()
  } catch {}
  unmount = initial() || (() => {})
  try {
    globalThis && (globalThis[UNMOUNT_GLOBAL_KEY] = unmount)
  } catch {}
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') {
      try {
        typeof unmount === 'function' && unmount()
      } catch {}
      unmount = initial() || (() => {})
      try {
        globalThis && (globalThis[UNMOUNT_GLOBAL_KEY] = unmount)
      } catch {}
    }
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
  fetchCSS().then((response) => style.replace(response))

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
  title.textContent = 'Welcome to your Content Script Extension'
  contentDiv.appendChild(title)

  // Create and append description paragraph
  const desc = document.createElement('p')
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

async function fetchCSS() {
  const cssUrl = new URL('./styles.css', import.meta.url)
  const response = await fetch(cssUrl)
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}
