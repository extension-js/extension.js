import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'

console.log('Hello from content script')

/**
 * Injects our React app into the page using Shadow DOM for style and DOM isolation.
 *
 * Why Shadow DOM?
 * ---------------
 * - Keeps our extension UI separate from the page's styles and elements.
 * - Prevents CSS conflicts and accidental DOM interference.
 * - Essential for browser extensions, since we can't predict the host page's code.
 */
export default function initial() {
  // Create a host div and attach it to the page
  const rootDiv = document.createElement('div')
  document.body.appendChild(rootDiv)

  // Attach a shadow root for isolation
  const shadow = rootDiv.attachShadow({mode: 'open'})

  // Add our styles
  const style = document.createElement('style')
  shadow.appendChild(style)
  fetchCSS().then((css) => {
    style.textContent = css
  })

  // Add a container for React
  const container = document.createElement('div')
  shadow.appendChild(container)

  // Mount React app
  const root = ReactDOM.createRoot(container)
  root.render(<ContentApp />)

  // Cleanup function
  return () => {
    root.unmount()
    rootDiv.remove()
  }
}

// Loads extension CSS as a string for injection into the shadow root
async function fetchCSS() {
  const url = new URL('./styles.css', import.meta.url)
  const res = await fetch(url)
  const css = await res.text()
  return res.ok ? css : Promise.reject(css)
}
