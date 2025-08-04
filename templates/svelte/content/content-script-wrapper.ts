/**
 * Content Script Wrapper Module for Svelte
 *
 * This module handles all the internal content script logic including:
 * - Shadow DOM creation and management
 * - CSS injection using the working example pattern
 * - Hot module replacement (HMR) setup
 * - Lifecycle management (mount/unmount)
 * - DOM element creation and cleanup
 */

// Import the content script function and its default options
import contentScript from './scripts'

// Type declarations for webpack HMR
declare global {
  interface ImportMeta {
    webpackHot?: {
      accept: (module?: string, callback?: () => void) => void
      dispose: (callback: () => void) => void
    }
  }
}

export interface ContentScriptOptions {
  /** ID for the root element */
  rootId?: string
  /** CSS class for the container */
  containerClass?: string
  /** Custom stylesheets to inject (array of strings) */
  stylesheets?: string[]
}

export interface ContentScriptInstance {
  /** Mount the content script */
  mount: (
    renderFunction: (container: HTMLElement) => (() => void) | void
  ) => void
  /** Unmount the content script */
  unmount: () => void
  /** Get the current container element */
  getContainer: () => HTMLElement | null
  /** Get the shadow root (if using shadow DOM) */
  getShadowRoot: () => ShadowRoot | null
}

// Use default options
const DEFAULT_OPTIONS = {
  rootId: 'extension-root',
  containerClass: 'content_script',
  stylesheets: ['./styles.css']
}

export class ContentScriptWrapper implements ContentScriptInstance {
  private options: Required<ContentScriptOptions>
  private rootElement: HTMLElement | null = null
  private shadowRoot: ShadowRoot | null = null
  private container: HTMLElement | null = null
  private unmountFunction: (() => void) | null = null
  private styleElement: HTMLStyleElement | null = null

  constructor(options: ContentScriptOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options
    }
  }

  /**
   * Mount the content script with the provided render function
   */
  async mount(
    renderFunction: (container: HTMLElement) => (() => void) | void
  ): Promise<void> {
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
        const unmountFn = renderFunction(this.container!)
        if (typeof unmountFn === 'function') {
          this.unmountFunction = unmountFn
        }
      } catch (error) {
        console.error('Render function failed, adding fallback content:', error)
        // Add fallback content if Svelte rendering fails
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        this.container!.innerHTML = `
          <div style="text-align: center;">
            <h3>Extension Content</h3>
            <p>Svelte rendering failed, but the wrapper is working!</p>
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
  unmount(): void {
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
  getContainer(): HTMLElement | null {
    return this.container
  }

  /**
   * Get the shadow root (if using shadow DOM) */
  getShadowRoot(): ShadowRoot | null {
    return this.shadowRoot
  }

  /**
   * Create the root element and append to document body
   */
  private createRootElement(): void {
    this.rootElement = document.createElement('div')
    this.rootElement.id = this.options.rootId
    document.body.appendChild(this.rootElement)
  }

  /**
   * Setup shadow DOM for style isolation
   */
  private setupShadowDOM(): void {
    if (!this.rootElement) return
    this.shadowRoot = this.rootElement.attachShadow({mode: 'open'})
  }

  /**
   * Inject styles using the working example pattern
   */
  private async injectStyles(): Promise<void> {
    const targetRoot = this.shadowRoot || this.rootElement!

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
  private async fetchCSS(): Promise<string> {
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
  private setupCSSHMR(): void {
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
   * Create the container element for the Svelte app
   */
  private createContainer(): void {
    this.container = document.createElement('div')
    this.container.className = this.options.containerClass

    const targetRoot = this.shadowRoot || this.rootElement!
    targetRoot.appendChild(this.container)
  }

  /**
   * Cleanup all resources
   */
  private cleanup(): void {
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
export function createContentScriptWrapper(
  options?: ContentScriptOptions
): ContentScriptWrapper {
  return new ContentScriptWrapper(options)
}

/**
 * Initialize content script when DOM is ready
 */
export function initializeContentScript(
  options: ContentScriptOptions = {},
  renderFunction: (container: HTMLElement) => (() => void) | void
): ContentScriptInstance {
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
export function autoInitializeContentScript(
  options: ContentScriptOptions = {}
): ContentScriptInstance {
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
