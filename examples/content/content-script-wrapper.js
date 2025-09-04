// Content Script Wrapper - Standalone version
// This wrapper provides Shadow DOM isolation and CSS injection for content scripts

import logo from './images/logo.png'

// Content script wrapper class
class ContentScriptWrapper {
  constructor(renderFunction, options = {}) {
    this.renderFunction = renderFunction
    this.options = {
      rootId: 'extension-root',
      containerClass: 'content_script',
      stylesheets: ['./content/styles.css'],
      ...options
    }
    this.rootElement = null
    this.shadowRoot = null
    this.styleElement = null
    this.unmountFunction = null
  }

  mount(container) {
    if (this.rootElement) {
      this.unmount()
    }

    // Create root element
    this.rootElement = container || document.createElement('div')
    this.rootElement.id = this.options.rootId
    this.rootElement.className = this.options.containerClass

    // Create shadow root for style isolation
    this.shadowRoot = this.rootElement.attachShadow({mode: 'open'})

    // Inject styles
    this.injectStyles()

    // Render content
    const result = this.renderFunction(this.shadowRoot)
    if (typeof result === 'function') {
      this.unmountFunction = result
    }

    // Append to document if no container provided
    if (!container) {
      document.body.appendChild(this.rootElement)
    }
  }

  unmount() {
    if (this.unmountFunction) {
      this.unmountFunction()
      this.unmountFunction = null
    }

    if (this.rootElement && this.rootElement.parentNode) {
      this.rootElement.parentNode.removeChild(this.rootElement)
    }

    this.rootElement = null
    this.shadowRoot = null
    this.styleElement = null
  }

  async injectStyles() {
    const targetRoot = this.shadowRoot || this.rootElement

    // Create style element
    this.styleElement = document.createElement('style')
    targetRoot.appendChild(this.styleElement)

    // Fetch CSS using the working example pattern
    try {
      const cssContent = await this.fetchCSS()
      this.styleElement.textContent = cssContent
      console.log('✅ CSS injected successfully')
    } catch (error) {
      console.error('❌ Failed to inject CSS:', error)
    }

    // Setup HMR for CSS files
    this.setupCSSHMR()
  }

  async fetchCSS() {
    let allCSS = ''

    for (const stylesheet of this.options.stylesheets) {
      try {
        const cssUrl = new URL(stylesheet, import.meta.url)
        const response = await fetch(cssUrl)
        const text = await response.text()
        if (response.ok) {
          allCSS += text + '\n'
        } else {
          console.warn('⚠️ Failed to fetch CSS:', stylesheet)
        }
      } catch (error) {
        console.warn('⚠️ Failed to fetch CSS:', stylesheet, error)
      }
    }

    return allCSS || '/* No CSS loaded */'
  }

  setupCSSHMR() {
    if (!import.meta.webpackHot) return

    // Setup HMR for each CSS file
    for (const stylesheet of this.options.stylesheets) {
      import.meta.webpackHot?.accept(stylesheet, async () => {
        try {
          const cssContent = await this.fetchCSS()
          if (this.styleElement) {
            this.styleElement.textContent = cssContent
            console.log('✅ CSS updated via HMR:', stylesheet)
          }
        } catch (error) {
          console.error('❌ Failed to update CSS via HMR:', stylesheet, error)
        }
      })
    }
  }
}

// Extract the render function from the original content script
function createRenderFunction(shadowRoot) {
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
  desc.className = 'content_description'
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
    contentDiv.remove()
  }
}

// Simple initialization like the original working code
let unmount

async function initialize() {
  if (unmount) {
    unmount()
  }

  // Use the wrapper instead of the original initial function
  const wrapper = new ContentScriptWrapper(createRenderFunction, {})
  wrapper.mount()
  unmount = () => wrapper.unmount()
}

if (import.meta.webpackHot) {
  import.meta.webpackHot?.accept()
  import.meta.webpackHot?.dispose(() => unmount?.())

  // Accept changes to this file
  import.meta.webpackHot?.accept(() => {
    initialize()
  })
}

if (document.readyState === 'complete') {
  initialize()
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') {
      initialize()
    }
  })
}
