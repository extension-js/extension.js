// The directive below tells Extension.js to inject the content
// script of this file into the shadow DOM of the host page and
// inject all CSS imports into it. This provides style isolation
// and prevents conflicts with the host page's styles.
// See https://extension.js.org/docs/content-scripts#use-shadow-dom
'use shadow-dom'

import logo from '../images/logo.svg'
import './styles.css'

export interface ContentScriptOptions {
  rootElement?: string
  rootClassName?: string
}

export default function contentScript(_options: ContentScriptOptions = {}) {
  return (container: HTMLElement) => {
    // Create content wrapper div
    const contentDiv = document.createElement('div')
    contentDiv.className = 'content_script'

    // Create and append logo image
    const img = document.createElement('img')
    img.className = 'content_logo'
    img.src = logo
    img.alt = 'TypeScript Logo'
    contentDiv.appendChild(img)

    // Create and append title
    const title = document.createElement('h1')
    title.className = 'content_title'
    title.textContent = 'TypeScript Extension'
    contentDiv.appendChild(title)

    // Create and append description paragraph
    const desc = document.createElement('p')
    desc.className = 'content_description'
    desc.innerHTML =
      'This content script runs in the context of web pages.<br />Learn more about creating cross-browser extensions at '

    const link = document.createElement('a')
    link.href = 'https://extension.js.org'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = 'https://extension.js.org'

    desc.appendChild(link)
    contentDiv.appendChild(desc)

    // Append content div to container
    container.appendChild(contentDiv)

    return () => {
      // Cleanup function
      container.innerHTML = ''
    }
  }
}
