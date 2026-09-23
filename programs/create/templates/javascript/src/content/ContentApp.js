import logo from '../images/icon.png'

// Named one by one so the bundler can fold each build down to a single
// branch. waterfox and librewolf are gecko, and used to fall to chromium.
const isFirefoxLike =
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'waterfox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'librewolf' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'gecko-based'

export default function createContentApp() {
  const container = document.createElement('div')
  container.className = 'content_script'

  // Firefox cannot open a sidebar from a message listener, so the gecko build
  // renders a hint naming the toolbar action instead of a dead control.
  const pill = document.createElement(isFirefoxLike ? 'div' : 'button')
  pill.className = isFirefoxLike
    ? 'content_pill content_pill_static'
    : 'content_pill'

  if (!isFirefoxLike) {
    pill.type = 'button'
    pill.setAttribute('aria-label', 'Open sidebar')
    pill.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({type: 'openSidebar'})
      } catch (error) {
        console.error(error)
      }
    })
  }

  const img = document.createElement('img')
  img.className = 'content_pill_logo'
  img.src = logo
  img.alt = ''
  img.setAttribute('aria-hidden', 'true')

  const text = document.createElement('span')
  text.className = 'content_pill_text'
  text.textContent = isFirefoxLike
    ? 'Use the toolbar icon to open the sidebar'
    : 'Open sidebar'

  pill.appendChild(img)
  pill.appendChild(text)
  container.appendChild(pill)

  return container
}
