// The directive below tells Extension.js to inject the content
// script of this file into the shadow DOM of the host page and
// inject all CSS imports into it. This provides style isolation
// and prevents conflicts with the host page's styles.
// See https://extension.js.org/docs/content-scripts#use-shadow-dom
'use shadow-dom'

import logo from '../images/logo.png'
import './styles.css'

/**
 * @typedef {Object} ContentScriptOptions
 * @property {string} [rootElement] - The root element ID
 * @property {string} [rootClassName] - The root element class name
 */
export default function contentScript(options = {}) {
  return (container) => {
    // Create and append logo image
    const img = document.createElement('img')
    img.className = 'content_logo'
    img.src = logo
    img.alt = 'Extension Logo'
    container.appendChild(img)

    // Create and append title
    const title = document.createElement('h1')
    title.className = 'content_title'
    title.textContent = 'Welcome to your Content Script Extension'
    container.appendChild(title)

    // Create and append description paragraph
    const desc = document.createElement('p')
    desc.className = 'content_description'
    desc.innerHTML = 'Learn more about creating cross-browser extensions at '

    const link = document.createElement('a')
    link.href = 'https://extension.js.org'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = 'https://extension.js.org'

    desc.appendChild(link)
    container.appendChild(desc)

    // Return cleanup function for unmounting (required)
    return () => {
      // JavaScript doesn't need special cleanup, so we just return empty
      container.innerHTML = ''
    }
  }
}
