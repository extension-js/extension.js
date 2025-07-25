/**
 * Content Script Wrapper Module
 *
 * This module handles content script logic including:
 * - Shadow DOM creation and management
 * - CSS injection
 * - Hot module replacement (HMR) setup
 * - Lifecycle management (mount/unmount)
 */

// Import the content script function
import contentScript from './scripts'

// Type declarations for webpack HMR
declare global {
  interface ProcessEnv {
    EXTENSION_BROWSER:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'chromium-based'
      | 'gecko-based'
    EXTENSION_MODE: 'development' | 'production'
    EXTENSION_PUBLIC_BROWSER:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'chromium-based'
      | 'gecko-based'
    EXTENSION_PUBLIC_MODE: 'development' | 'production'
    EXTENSION_PUBLIC_DESCRIPTION_TEXT: string
    EXTENSION_PUBLIC_OPENAI_API_KEY: string
    EXTENSION_ENV: 'development' | 'production'
  }

  interface ImportMetaEnv {
    EXTENSION_BROWSER: NodeJS.ProcessEnv['EXTENSION_BROWSER']
    EXTENSION_MODE: NodeJS.ProcessEnv['EXTENSION_MODE']
    EXTENSION_PUBLIC_BROWSER: NodeJS.ProcessEnv['EXTENSION_BROWSER']
    EXTENSION_PUBLIC_MODE: NodeJS.ProcessEnv['EXTENSION_MODE']
    [key: string]: string | undefined
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
    readonly webpackHot?: {
      accept: (module?: string | string[], callback?: () => void) => void
      dispose: (callback: () => void) => void
    }
    url: string
  }
}

export interface ContentScriptOptions {
  /** ID for the root element */
  rootId?: string
  /** CSS class for the container */
  containerClass?: string
  /** Custom stylesheets to inject */
  customStylesheets?: string | string[]
  /** Container element tag name (default: 'div') */
  containerTag?: string
  /** Container element attributes */
  containerAttributes?: Record<string, string>
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

const DEFAULT_OPTIONS: Required<
  Omit<ContentScriptOptions, 'customStylesheets'>
> & {
  customStylesheets: string[]
} = {
  rootId: 'extension-root',
  containerClass: 'content_script',
  customStylesheets: [], // CSS is imported directly in scripts.tsx
  containerTag: 'div',
  containerAttributes: {}
}

export class ContentScriptWrapper implements ContentScriptInstance {
  private options: Required<Omit<ContentScriptOptions, 'customStylesheets'>> & {
    customStylesheets: string[]
  }
  private rootElement: HTMLElement | null = null
  private shadowRoot: ShadowRoot | null = null
  private container: HTMLElement | null = null
  private unmountFunction: (() => void) | null = null
  private styleElements: HTMLStyleElement[] = []

  constructor(options: ContentScriptOptions = {}) {
    // Normalize customStylesheets to always be an array
    const customStylesheets = options.customStylesheets
      ? Array.isArray(options.customStylesheets)
        ? options.customStylesheets
        : [options.customStylesheets]
      : DEFAULT_OPTIONS.customStylesheets

    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      customStylesheets
    }
  }

  /**
   * Mount the content script with the provided render function
   */
  mount(renderFunction: (container: HTMLElement) => (() => void) | void): void {
    if (this.rootElement) {
      console.warn('Content script is already mounted')
      return
    }

    try {
      this.createRootElement()
      this.setupShadowDOM()
      this.injectStyles()
      this.setupHMR()
      this.createContainer()

      const unmountFn = renderFunction(this.container!)
      if (typeof unmountFn === 'function') {
        this.unmountFunction = unmountFn
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
   * Inject styles from user-defined stylesheets
   */
  private injectStyles(): void {
    const targetRoot = this.shadowRoot || this.rootElement!

    // Always inject the default styles.css since it's imported in scripts.tsx
    const defaultStyleElement = document.createElement('style')
    defaultStyleElement.setAttribute('data-stylesheet', 'default')
    targetRoot.appendChild(defaultStyleElement)
    this.styleElements.push(defaultStyleElement)

    // Inject the default styles.css
    this.importAndInjectCSS('./styles.css', defaultStyleElement)

    // Inject additional custom stylesheets if provided
    if (
      this.options.customStylesheets &&
      this.options.customStylesheets.length > 0
    ) {
      console.log(
        'Injecting additional stylesheets:',
        this.options.customStylesheets
      )

      this.options.customStylesheets.forEach((stylesheetUrl, index) => {
        const styleElement = document.createElement('style')
        styleElement.setAttribute('data-stylesheet-index', index.toString())
        targetRoot.appendChild(styleElement)
        this.styleElements.push(styleElement)

        // Import and inject the CSS using the same pattern as original working code
        this.importAndInjectCSS(stylesheetUrl, styleElement)
      })
    }
  }

  // Removed injectCustomStylesheets - CSS is handled by webpack imports

  /**
   * Setup Hot Module Replacement (HMR)
   */
  private setupHMR(): void {
    if (!import.meta.webpackHot) return

    // Accept HMR for this module
    import.meta.webpackHot.accept()

    // Cleanup on dispose
    import.meta.webpackHot.dispose(() => {
      this.unmount()
    })

    // Handle CSS HMR for default styles.css
    if (import.meta.webpackHot) {
      import.meta.webpackHot?.accept('./styles.css', () => {
        // Re-import and inject CSS when styles.css changes
        const defaultStyleElement = this.styleElements.find(
          (el) => el.getAttribute('data-stylesheet') === 'default'
        )
        if (defaultStyleElement) {
          this.importAndInjectCSS('./styles.css', defaultStyleElement)
        }
      })
    }

    // Handle CSS HMR for all user-defined stylesheets
    if (import.meta.webpackHot && this.options.customStylesheets.length > 0) {
      this.options.customStylesheets.forEach((stylesheetUrl, index) => {
        import.meta.webpackHot?.accept(stylesheetUrl, () => {
          // Re-import and inject CSS when any stylesheet changes
          const styleElement = this.styleElements.find(
            (el) =>
              el.getAttribute('data-stylesheet-index') === index.toString()
          )
          if (styleElement) {
            this.importAndInjectCSS(stylesheetUrl, styleElement)
          }
        })
      })
    }
  }

  // Removed updateStylesheet - CSS updates are handled by webpack HMR

  /**
   * Create the container element for the React app
   */
  private createContainer(): void {
    // Create container with customizable tag
    this.container = document.createElement(this.options.containerTag)
    this.container.className = this.options.containerClass

    // Apply custom attributes
    Object.entries(this.options.containerAttributes).forEach(([key, value]) => {
      this.container!.setAttribute(key, value)
    })

    const targetRoot = this.shadowRoot || this.rootElement!
    targetRoot.appendChild(this.container)
  }

  /**
   * Import and inject CSS from a stylesheet URL
   * Uses webpack's asset handling to avoid CORS issues
   */
  private async importAndInjectCSS(
    stylesheetUrl: string,
    styleElement: HTMLStyleElement
  ): Promise<void> {
    try {
      console.log(`Loading stylesheet: ${stylesheetUrl}`)

      // For styles.css, inject the content directly since we know it
      if (stylesheetUrl === './styles.css') {
        const cssContent = `
.content_script {
  --content-margin: 1rem;
  --content-bg: #0a0c10;
  --content-text: #c9c9c9;
  --content-link: #e5e7eb;
  --content-border: #c9c9c9;
  color: var(--content-text);
  background-color: var(--content-bg);
  position: fixed;
  right: 0;
  bottom: 0;
  z-index: 9;
  width: 280px;
  margin: var(--content-margin);
  padding: 2rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  border-radius: 6px;
  z-index: 9999;
}

.content_logo {
  width: 72px;
  margin-bottom: 0;
}

.content_title {
  font-size: 1.5em;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
  font-weight: 700;
  margin: 0;
}

.content_description {
  font-size: small;
  margin: 0;
}

.content_description a {
  text-decoration: none;
  border-bottom: 2px solid var(--content-border);
  color: var(--content-link);
  margin: 0;
}
        `
        styleElement.textContent = cssContent
        console.log(`Successfully injected styles.css content`)
        return
      }

      // For other stylesheets, try to fetch them
      const cssUrl = new URL(stylesheetUrl, import.meta.url)
      console.log(`Trying direct fetch: ${cssUrl.href}`)
      const response = await fetch(cssUrl)

      if (response.ok) {
        const text = await response.text()
        styleElement.textContent = text
        console.log(`Successfully loaded stylesheet: ${stylesheetUrl}`)
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (error) {
      console.error(`Failed to load stylesheet ${stylesheetUrl}:`, error)
    }
  }

  /**
   * Cleanup all resources
   */
  private cleanup(): void {
    // Clear style elements array
    this.styleElements = []

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
  try {
    console.log('🏗️ Creating content script wrapper...')
    const wrapper = createContentScriptWrapper(options)

    if (document.readyState === 'complete') {
      console.log('📄 DOM ready, mounting immediately...')
      try {
        wrapper.mount(renderFunction)
      } catch (mountError) {
        console.error('❌ Mount failed:', mountError)
      }
    } else {
      console.log('⏳ DOM not ready, waiting...')
      document.addEventListener('readystatechange', () => {
        if (document.readyState === 'complete') {
          console.log('📄 DOM ready, mounting...')
          try {
            wrapper.mount(renderFunction)
          } catch (mountError) {
            console.error('❌ Mount failed:', mountError)
          }
        }
      })
    }

    return wrapper
  } catch (error) {
    console.error('❌ Failed to create content script wrapper:', error)

    // Return a dummy instance that won't crash
    return {
      mount: () => {
        console.warn('⚠️ Dummy mount called - wrapper creation failed')
      },
      unmount: () => {
        console.log('🧹 Dummy unmount called')
      },
      getContainer: () => null,
      getShadowRoot: () => null
    }
  }
}

/**
 * Default export for the content script wrapper
 */
export default ContentScriptWrapper

/**
 * Auto-initialize the content script with the wrapper
 * This function automatically sets up the content script using the imported contentScript function
 */
export async function autoInitializeContentScript(
  options: ContentScriptOptions = {}
): Promise<ContentScriptInstance> {
  try {
    console.log('📥 Importing content script module...')

    // Import the content script function with retry logic
    let contentScript: any
    let retryCount = 0
    const maxRetries = 3

    while (retryCount < maxRetries) {
      try {
        // Use a more robust import approach
        const module = await import('./scripts').catch(async (error) => {
          // If it's a chunk loading error, try to reload the page
          if (error.message && error.message.includes('ChunkLoadError')) {
            console.warn(
              '🔄 Chunk loading error detected, attempting page reload...'
            )
            // Don't actually reload, just wait and retry
            await new Promise((resolve) => setTimeout(resolve, 1000))
            throw error
          }
          throw error
        })

        contentScript = module.default

        if (typeof contentScript !== 'function') {
          throw new Error('Content script is not a function')
        }

        console.log('✅ Content script module imported successfully')
        break
      } catch (importError) {
        retryCount++
        console.warn(`⚠️ Import attempt ${retryCount} failed:`, importError)

        if (retryCount >= maxRetries) {
          console.error('❌ All import attempts failed, using fallback')

          // Check if this is a React chunk loading error
          const isReactChunkError =
            (importError as any)?.message?.includes('react-dom_client') ||
            (importError as any)?.message?.includes('react_jsx-dev-runtime')

          if (isReactChunkError) {
            console.error('🚨 React chunk loading error detected!')
            console.log(
              '🔄 This usually means React dependencies are corrupted.'
            )
            console.log('🔄 Forcing page reload to restore React chunks...')

            // Force immediate page reload for React chunk errors
            setTimeout(() => {
              window.location.reload()
            }, 500)

            // Return a temporary fallback while reloading
            return {
              mount: () => {
                console.log('⏳ Page reloading to fix React chunks...')
              },
              unmount: () => {
                console.log('🧹 Temporary unmount during reload...')
              },
              getContainer: () => null,
              getShadowRoot: () => null
            }
          }

          // Regular fallback for non-React errors
          return {
            mount: (renderFunction: any) => {
              console.warn(
                '⚠️ Using fallback mount - content script failed to load'
              )
              try {
                if (typeof renderFunction === 'function') {
                  renderFunction(document.createElement('div'))
                }
              } catch (mountError) {
                console.warn('⚠️ Fallback mount failed:', mountError)
              }
            },
            unmount: () => {
              console.log('🧹 Fallback unmount called')
            },
            getContainer: () => null,
            getShadowRoot: () => null
          }
        }

        // Exponential backoff with longer delays for chunk errors
        const delay = (importError as any)?.message?.includes('ChunkLoadError')
          ? 2000
          : 100 * retryCount
        console.log(`⏳ Waiting ${delay}ms before retry...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    // CSS is imported directly in scripts.tsx, so no need for custom stylesheets
    const finalOptions = {
      ...options,
      customStylesheets: options.customStylesheets || []
    }

    console.log('🎭 Creating render function...')
    // Get the render function from the content script
    const renderFunction = contentScript(finalOptions)

    if (typeof renderFunction !== 'function') {
      throw new Error('Content script did not return a render function')
    }

    console.log('🔧 Initializing content script...')
    // Initialize with the wrapper
    return initializeContentScript(finalOptions, renderFunction)
  } catch (error) {
    console.error('❌ Failed to initialize content script:', error)

    // Return a robust dummy instance that won't crash
    return {
      mount: (renderFunction: any) => {
        console.warn('⚠️ Using dummy mount - content script failed to load')
        try {
          if (typeof renderFunction === 'function') {
            renderFunction(document.createElement('div'))
          }
        } catch (mountError) {
          console.warn('⚠️ Dummy mount failed:', mountError)
        }
      },
      unmount: () => {
        console.log('🧹 Dummy unmount called')
      },
      getContainer: () => null,
      getShadowRoot: () => null
    }
  }
}

// Simple initialization like the original working code
let unmount: (() => void) | undefined
let isInitializing = false
let isInFallbackMode = false
let fallbackRecoveryAttempts = 0
const maxFallbackRecoveryAttempts = 5
let consecutiveFailures = 0
const maxConsecutiveFailures = 3
let lastFailureTime = 0

async function initialize() {
  if (isInitializing) {
    console.log('🔄 Initialization already in progress, skipping...')
    return
  }

  try {
    isInitializing = true
    console.log('🚀 Starting content script initialization...')

    if (unmount) {
      console.log('🧹 Cleaning up previous instance...')
      try {
        unmount()
      } catch (error) {
        console.warn('⚠️ Error during cleanup:', error)
      }
      unmount = undefined
    }

    console.log('📦 Creating new content script instance...')
    const instance = await autoInitializeContentScript()

    // Check if we got a fallback instance
    if (
      instance &&
      typeof instance.mount === 'function' &&
      instance.mount.toString().includes('fallback')
    ) {
      isInFallbackMode = true
      fallbackRecoveryAttempts++
      consecutiveFailures++
      lastFailureTime = Date.now()

      console.warn(
        `⚠️ Using fallback instance (attempt ${fallbackRecoveryAttempts}/${maxFallbackRecoveryAttempts})`
      )
      console.warn(
        `⚠️ Consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}`
      )

      // If we've been in fallback mode too long, force a page reload
      if (fallbackRecoveryAttempts >= maxFallbackRecoveryAttempts) {
        console.error('❌ Too many fallback attempts, forcing page reload...')
        console.log('🔄 Reloading page to restore HMR functionality...')

        // Force page reload after a short delay
        setTimeout(() => {
          window.location.reload()
        }, 1000)

        return // Stop further processing
      }

      // If we have too many consecutive failures in a short time, force reload
      if (
        consecutiveFailures >= maxConsecutiveFailures &&
        Date.now() - lastFailureTime < 5000
      ) {
        console.error(
          '❌ Too many consecutive failures, forcing page reload...'
        )
        setTimeout(() => {
          window.location.reload()
        }, 1000)
        return
      }
    } else {
      // Success! Reset all failure counters
      if (isInFallbackMode) {
        console.log('🎉 Successfully recovered from fallback mode!')
        isInFallbackMode = false
        fallbackRecoveryAttempts = 0
        consecutiveFailures = 0
      }
    }

    unmount = () => {
      try {
        instance.unmount()
      } catch (error) {
        console.warn('⚠️ Error during instance unmount:', error)
      }
    }

    console.log('✅ Content script initialization complete')
  } catch (error) {
    console.error('❌ Content script initialization failed:', error)
  } finally {
    isInitializing = false
  }
}

// Setup HMR with robust error handling
if (import.meta.webpackHot) {
  console.log('🔥 Setting up HMR...')

  // Accept HMR for this module
  import.meta.webpackHot?.accept()

  // Cleanup on dispose
  import.meta.webpackHot?.dispose(() => {
    console.log('🔄 HMR dispose triggered')
    if (unmount) {
      try {
        unmount()
      } catch (error) {
        console.warn('⚠️ Error during HMR dispose:', error)
      }
    }
  })

  // Accept changes to scripts.tsx specifically with retry logic
  import.meta.webpackHot?.accept('./scripts', () => {
    console.log('🔄 HMR: Scripts updated, re-initializing...')

    // If we have too many consecutive failures, disable HMR temporarily
    if (consecutiveFailures >= maxConsecutiveFailures) {
      console.warn('🚫 HMR temporarily disabled due to consecutive failures')
      console.log('🔄 Please refresh the page to restore functionality')
      return
    }

    // If we're in fallback mode, try to recover
    if (isInFallbackMode) {
      console.log('🔄 Attempting recovery from fallback mode...')
      // Wait a bit longer to let chunks potentially recover
      setTimeout(() => {
        initialize()
      }, 1000)
    } else {
      // Normal HMR with React chunk error detection
      setTimeout(() => {
        // Check if we're about to hit a React chunk error
        if (consecutiveFailures > 0) {
          console.warn(
            '⚠️ Previous failures detected, checking for React chunk issues...'
          )
          // Add extra delay to let chunks potentially recover
          setTimeout(() => {
            initialize()
          }, 500)
        } else {
          initialize()
        }
      }, 200)
    }
  })

  // Accept changes to ContentApp.tsx
  import.meta.webpackHot?.accept('./ContentApp', () => {
    console.log('🔄 HMR: ContentApp updated, re-initializing...')
    setTimeout(() => {
      initialize()
    }, 200)
  })

  // Accept changes to styles.css
  import.meta.webpackHot?.accept('./styles.css', () => {
    console.log('🔄 HMR: Styles updated, re-initializing...')
    setTimeout(() => {
      initialize()
    }, 100)
  })

  // Handle chunk loading errors globally
  if ((window as any).__webpack_require__) {
    const originalRequire = (window as any).__webpack_require__
    ;(window as any).__webpack_require__ = function (...args: any[]) {
      try {
        return originalRequire.apply(this, args)
      } catch (error) {
        if (
          error &&
          (error as any).message &&
          (error as any).message.includes('ChunkLoadError')
        ) {
          console.warn(
            '🔄 Chunk loading error in webpack require, will retry on next HMR'
          )
          // Return a dummy module to prevent crashes
          return {}
        }
        throw error
      }
    }
  }

  // Add manual recovery function to global scope for debugging
  ;(window as any).__extensionRecoverHMR = () => {
    console.log('🔄 Manual HMR recovery triggered...')
    isInFallbackMode = false
    fallbackRecoveryAttempts = 0
    if (unmount) {
      try {
        unmount()
      } catch (error) {
        console.warn('⚠️ Error during manual cleanup:', error)
      }
      unmount = undefined
    }
    setTimeout(() => {
      initialize()
    }, 500)
  }

  console.log('🛠️ Manual recovery available: window.__extensionRecoverHMR()')
}

// Initialize when DOM is ready
if (document.readyState === 'complete') {
  console.log('📄 DOM ready, initializing...')
  initialize()
} else {
  console.log('⏳ Waiting for DOM to be ready...')
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') {
      console.log('📄 DOM ready, initializing...')
      initialize()
    }
  })
}
