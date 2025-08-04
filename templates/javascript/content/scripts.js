import logo from '../images/logo.png'

// Import CSS to ensure webpack processes it as an asset
// This is required for content scripts to have CSS available
import './styles.css'

export default function contentScript({
  rootId = 'extension-root',
  containerClass = 'content_script',
  stylesheets = ['./styles.css']
} = {}) {
  return (container) => {
    // Create and append logo image
    const img = document.createElement('img')
    img.className = 'content_logo'
    img.src = logo
    container.appendChild(img)

    // Create and append title
    const title = document.createElement('h1')
    title.className = 'content_title'
    title.innerHTML = 'Content Script<br />JavaScript Extension'
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
      // JavaScript doesn't need special cleanup, so we just return empty
    }
  }
}
