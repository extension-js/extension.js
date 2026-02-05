import iconUrl from '../images/icon.png'
const logo = iconUrl

export default function createContentApp(): HTMLDivElement {
  const envBrowser = import.meta.env.EXTENSION_PUBLIC_BROWSER
  const isFirefoxLike =
    envBrowser === 'firefox' ||
    envBrowser === 'gecko-based' ||
    /Firefox/i.test(navigator.userAgent)

  const container = document.createElement('div')
  container.className = 'content_script'

  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = 'content_pill'
  pill.setAttribute('aria-label', 'Open sidebar')
  if (isFirefoxLike) {
    pill.disabled = true
  }
  pill.addEventListener('click', () => {
    if (isFirefoxLike) return
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({type: 'openSidebar'})
    }
  })

  const img = document.createElement('img')
  img.className = 'content_pill_logo'
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  img.src = logo
  img.alt = ''
  img.setAttribute('aria-hidden', 'true')

  const text = document.createElement('span')
  text.className = 'content_pill_text'
  text.textContent = isFirefoxLike
    ? 'Click the browser action to open the sidebar'
    : 'Open sidebar'

  pill.appendChild(img)
  pill.appendChild(text)
  container.appendChild(pill)

  return container
}
