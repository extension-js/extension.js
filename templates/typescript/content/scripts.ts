import logo from '../images/logo.svg'

interface ContentScriptOptions {
  rootId?: string // ID for the root element
  containerClass?: string // CSS class for the container
  stylesheets?: string[] // Array of stylesheet paths to inject
}

export default function contentScript({
  rootId = 'extension-root',
  containerClass = 'content_script',
  stylesheets = ['./styles.css']
}: ContentScriptOptions) {
  return (container: HTMLElement) => {
    // Create and append logo image
    const img = document.createElement('img')
    img.className = 'content_logo'
    img.src = logo
    img.alt = 'TypeScript Logo'
    container.appendChild(img)

    // Create and append title
    const title = document.createElement('h1')
    title.className = 'content_title'
    title.innerHTML = 'Content Script<br />TypeScript Extension'
    container.appendChild(title)

    // Create and append description paragraph
    const desc = document.createElement('p')
    desc.className = 'content_description'
    desc.innerHTML =
      'This content script runs in the context of web pages.<br />Learn more about creating cross-browser extensions at '

    const link = document.createElement('a')
    link.href = 'https://extension.js.org'
    link.target = '_blank'
    link.textContent = 'https://extension.js.org'

    desc.appendChild(link)
    container.appendChild(desc)

    console.info('content_script configuration:', {
      rootId,
      containerClass,
      stylesheets
    })

    // Return cleanup function for unmounting (required)
    return () => {
      // TypeScript doesn't need special cleanup, so we just return empty
    }
  }
}
