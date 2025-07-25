import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'
import './styles.css'

interface ContentScriptOptions {
  rootId?: string // ID for the root element
  containerClass?: string // CSS class for the container
  stylesheets?: string[] // Array of stylesheet paths to inject
}

export default function contentScript({
  rootId = 'extension-root',
  containerClass = 'content_script',
  stylesheets = ['./styles.css']
}: ContentScriptOptions = {}) {
  return (container: HTMLElement) => {
    if (import.meta.env.EXTENSION_MODE === 'development') {
      console.info('Content script configuration', {
        rootId,
        containerClass,
        stylesheets
      })
    }

    const mountingPoint = ReactDOM.createRoot(container)
    mountingPoint.render(<ContentApp />)

    // Return cleanup function for unmounting (required)
    return () => {
      mountingPoint.unmount()
      console.clear()
    }
  }
}
