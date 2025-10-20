import logo from '../images/logo.png'

export default function createContentApp() {
  const container = document.createElement('div')
  container.className = 'content_script'

  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = 'content_pill'
  pill.setAttribute('aria-label', 'Open sidebar')
  pill.addEventListener('click', () => {
    try {
      globalThis.browser?.runtime?.sendMessage?.({type: 'openSidebar'})
      globalThis.chrome?.runtime?.sendMessage?.({type: 'openSidebar'})
    } catch (error) {
      console.error(error)
    }
  })

  const img = document.createElement('img')
  img.className = 'content_pill_logo'
  img.src = logo
  img.alt = ''
  img.setAttribute('aria-hidden', 'true')

  const text = document.createElement('span')
  text.className = 'content_pill_text'
  text.textContent = 'Open sidebar'

  pill.appendChild(img)
  pill.appendChild(text)
  container.appendChild(pill)

  return container
}
