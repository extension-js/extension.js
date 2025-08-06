import * as path from 'path'
import * as fs from 'fs'
import {urlToRequest} from 'loader-utils'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../webpack-types'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    },
    mode: {
      type: 'string'
    },
    includeList: {
      type: 'object'
    },
    excludeList: {
      type: 'object'
    }
  }
}

/**
 * Check if the project is using a JavaScript framework
 */
function isUsingJSFramework(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

  const frameworks = [
    'react',
    'vue',
    '@angular/core',
    'svelte',
    'solid-js',
    'preact'
  ]

  const dependencies = packageJson.dependencies || {}
  const devDependencies = packageJson.devDependencies || {}

  for (const framework of frameworks) {
    if (dependencies[framework] || devDependencies[framework]) {
      return true
    }
  }

  return false
}

/**
 * Generate the wrapper code that will be injected
 */
function generateWrapperCode(
  source: string,
  isReact: boolean,
  resourcePath: string
): string {
  const fileName = path.basename(resourcePath, path.extname(resourcePath))

  const wrapperCode = `
/**
 * Content Script Wrapper Module
 *
 * This module handles all the internal content script logic including:
 * - Shadow DOM creation and management
 * - CSS injection using the working example pattern
 * - Hot module replacement (HMR) setup
 * - Lifecycle management (mount/unmount)
 * - DOM element creation and cleanup
 */

// Import the content script function and its default options
import contentScript from './${fileName}'

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
  /** Custom stylesheets to inject (can be single string or array of strings) */
  stylesheets?: string | string[]
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

// Use default options from scripts.tsx to avoid hardcoding
const DEFAULT_OPTIONS = {
  rootId: 'extension-root',
  containerClass: 'content_script',
  stylesheets: ['./styles.css']
}

export class ContentScriptWrapper implements ContentScriptInstance {
  private options: Required<Omit<ContentScriptOptions, 'stylesheets'>> & {
    stylesheets: string[]
  }
  private rootElement: HTMLElement | null = null
  private shadowRoot: ShadowRoot | null = null
  private container: HTMLElement | null = null
  private unmountFunction: (() => void) | null = null
  private styleElement: HTMLStyleElement | null = null

  constructor(options: ContentScriptOptions = {}) {
    // Normalize stylesheets to always be an array
    const stylesheets = options.stylesheets
      ? Array.isArray(options.stylesheets)
        ? options.stylesheets
        : [options.stylesheets]
      : DEFAULT_OPTIONS.stylesheets

    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      stylesheets
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
        // Add fallback content if React rendering fails
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        this.container!.innerHTML = \`
          <div style="text-align: center;">
            <h3>Extension Content</h3>
            <p>React rendering failed, but the wrapper is working!</p>
            <p>Error: \${errorMessage}</p>
          </div>
        \`
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

  /**
   * Fetch CSS using the working example pattern
   */
  private async fetchCSS(): Promise<string> {
    const cssUrl = new URL('./styles.css', import.meta.url)
    const response = await fetch(cssUrl)
    const text = await response.text()
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
   * Create the container element for the React app
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
 * Default export for the content script wrapper
 */
export default ContentScriptWrapper

/**
 * Auto-initialize the content script with the wrapper
 * This function automatically sets up the content script using the imported contentScript function
 */
export function autoInitializeContentScript(
  options: ContentScriptOptions = {}
): ContentScriptInstance {
  // Normalize stylesheets to match the scripts.tsx API
  const normalizedOptions = {
    ...options,
    stylesheets: options.stylesheets
      ? Array.isArray(options.stylesheets)
        ? options.stylesheets
        : [options.stylesheets]
      : undefined
  }

  // Get the render function from the imported contentScript
  const renderFunction = contentScript(normalizedOptions)

  // Initialize with the wrapper using normalized options
  return initializeContentScript(normalizedOptions, renderFunction)
}

// Simple initialization like the original working code
let unmount: (() => void) | undefined

async function initialize() {
  if (unmount) {
    unmount()
  }
  const instance = autoInitializeContentScript()
  unmount = () => instance.unmount()
}

if (import.meta.webpackHot) {
  import.meta.webpackHot?.accept()
  import.meta.webpackHot?.dispose(() => unmount?.())

  // Accept changes to scripts.tsx specifically
  import.meta.webpackHot?.accept('./${fileName}', () => {
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
`

  return wrapperCode
}

export default function (this: LoaderContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  validate(schema, options, {
    name: 'scripts:add-content-script-wrapper',
    baseDataPath: 'options'
  })

  const url = urlToRequest(this.resourcePath)

  // Only apply to content scripts that are using JS frameworks
  if (manifest.content_scripts && isUsingJSFramework(projectPath)) {
    for (const contentScript of manifest.content_scripts) {
      if (!contentScript.js) continue

      for (const js of contentScript.js) {
        const absoluteUrl = path.resolve(projectPath, js as string)

        if (url.includes(absoluteUrl)) {
          // Check if this is a React/JS framework content script
          const isReact =
            source.includes('react') ||
            source.includes('ReactDOM') ||
            source.includes('createRoot') ||
            source.includes('render(')

          if (isReact) {
            const wrapperCode = generateWrapperCode(
              source,
              isReact,
              this.resourcePath
            )
            return wrapperCode
          }
        }
      }
    }
  }

  return source
}
