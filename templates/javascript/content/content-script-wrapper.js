/**
 * Content Script Wrapper Module for JavaScript
 *
 * This module handles all the internal content script logic including:
 * - Shadow DOM creation and management
 * - CSS injection using the working example pattern
 * - Hot module replacement (HMR) setup
 * - Lifecycle management (mount/unmount)
 * - DOM element creation and cleanup
 */

// Import the content script function and its default options
import contentScript from './scripts.js'

// Use default options
const DEFAULT_OPTIONS = {
  rootId: 'extension-root',
  containerClass: 'content_script',
  stylesheets: ['./styles.css']
}

export class ContentScriptWrapper {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options
    }
    this.rootElement = null
    this.shadowRoot = null
    this.container = null
    this.unmountFunction = null
    this.styleElement = null
  }

  /**
   * Mount the content script with the provided render function
   */
  async mount(renderFunction) {
    if (this.rootElement) {
      console.warn('Content script is already mounted')
      return
    }

    try {
      this.createRootElement()
      this.setupShadowDOM()
      await this.injectStyles()
      this.createContainer()

      // Call the render function with the container and store the unmount function
      try {
        const unmountFn = renderFunction(this.container)
        if (typeof unmountFn === 'function') {
          this.unmountFunction = unmountFn
        }
      } catch (error) {
        console.error('Render function failed, adding fallback content:', error)
        // Add fallback content if JavaScript rendering fails
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        this.container.innerHTML = `
          <div style="text-align: center;">
            <h3>Extension Content</h3>
            <p>JavaScript rendering failed, but the wrapper is working!</p>
            <p>Error: ${errorMessage}</p>
          </div>
        `
      }
    } catch (error) {
      console.error('Failed to mount content script:', error)
      this.cleanup()
    }
  }

  /**
   * Unmount the content script and cleanup resources
   */
  unmount() {
    if (this.unmountFunction) {
      this.unmountFunction()
      this.unmountFunction = null
    }
    this.cleanup()
    console.log('Content script unmounted')
  }

  /**
   * Get the current container element
   */
  getContainer() {
    return this.container
  }

  /**
   * Get the shadow root (if using shadow DOM) */
  getShadowRoot() {
    return this.shadowRoot
  }

  /**
   * Create the root element and append to document body
   */
  createRootElement() {
    this.rootElement = document.createElement('div')
    this.rootElement.id = this.options.rootId
    document.body.appendChild(this.rootElement)
  }

  /**
   * Setup shadow DOM for style isolation
   */
  setupShadowDOM() {
    if (!this.rootElement) return
    this.shadowRoot = this.rootElement.attachShadow({mode: 'open'})
  }

  /**
   * Inject styles using the working example pattern
   */
  async injectStyles() {
    const targetRoot = this.shadowRoot || this.rootElement

    // Create style element
    this.styleElement = document.createElement('style')
    targetRoot.appendChild(this.styleElement)
    console.log('🔍 Style element created and appended')

    // Fetch CSS using the working example pattern
    try {
      const cssContent = await this.fetchCSS()
      console.log(
        '🔍 Setting style element textContent with length:',
        cssContent.length
      )
      this.styleElement.textContent = cssContent
      console.log(
        '🔍 Style element textContent after setting:',
        this.styleElement.textContent?.length || 0
      )
      console.log('✅ CSS injected successfully')
    } catch (error) {
      console.error('❌ Failed to inject CSS:', error)
    }

    // Setup HMR for CSS files
    this.setupCSSHMR()
  }

  /**
   * Fetch CSS using the working example pattern
   */
  async fetchCSS() {
    const cssUrl = new URL('./styles.css', import.meta.url)
    console.log('🔍 Fetching CSS from:', cssUrl.href)
    console.log('🔍 import.meta.url:', import.meta.url)

    const response = await fetch(cssUrl)
    console.log('🔍 Response status:', response.status)
    console.log('🔍 Response ok:', response.ok)

    const text = await response.text()
    console.log('🔍 CSS content length:', text.length)
    console.log('🔍 CSS content preview:', text.substring(0, 100))

    return response.ok ? text : Promise.reject(text)
  }

  /**
   * Setup CSS HMR using the working example pattern
   */
  setupCSSHMR() {
    if (!import.meta.webpackHot) return

    import.meta.webpackHot?.accept('./styles.css', async () => {
      try {
        const cssContent = await this.fetchCSS()
        if (this.styleElement) {
          this.styleElement.textContent = cssContent
          console.log('✅ CSS updated via HMR')
        }
      } catch (error) {
        console.error('❌ Failed to update CSS via HMR:', error)
      }
    })
  }

  /**
   * Create the container element for the JavaScript app
   */
  createContainer() {
    this.container = document.createElement('div')
    this.container.className = this.options.containerClass

    const targetRoot = this.shadowRoot || this.rootElement
    targetRoot.appendChild(this.container)
  }

  /**
   * Cleanup all resources
   */
  cleanup() {
    if (this.styleElement && this.styleElement.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement)
      this.styleElement = null
    }

    if (this.rootElement) {
      this.rootElement.remove()
      this.rootElement = null
    }

    this.shadowRoot = null
    this.container = null
  }
}

/**
 * Factory function to create a content script wrapper
 */
export function createContentScriptWrapper(options) {
  return new ContentScriptWrapper(options)
}

/**
 * Initialize content script when DOM is ready
 */
export function initializeContentScript(options = {}, renderFunction) {
  const wrapper = createContentScriptWrapper(options)

  if (document.readyState === 'complete') {
    wrapper.mount(renderFunction)
  } else {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'complete') {
        wrapper.mount(renderFunction)
      }
    })
  }

  return wrapper
}

/**
 * Auto-initialize the content script with the wrapper
 * This function automatically sets up the content script using the imported contentScript function
 */
export function autoInitializeContentScript(options = {}) {
  // Get the render function from the imported contentScript
  const renderFunction = contentScript(options)

  // Initialize with the wrapper
  return initializeContentScript(options, renderFunction)
}

// Auto-initialize the content script with the wrapper
const instance = autoInitializeContentScript()

// Setup HMR for the content script
if (import.meta.webpackHot) {
  import.meta.webpackHot?.accept()
  import.meta.webpackHot?.dispose(() => instance.unmount())
}

// Export the instance for external use if needed
export default instance
