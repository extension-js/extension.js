import {createApp} from 'vue'
import ContentApp from './ContentApp.vue'

interface ContentScriptOptions {
  rootId?: string // ID for the root element
  containerClass?: string // CSS class for the container
  stylesheets?: string[] // Array of stylesheet paths to inject
}

export default function contentScript({
  rootId = 'extension-root',
  containerClass = 'content_script',
  stylesheets = ['./styles.css']
}: ContentScriptOptions) {
  return (container: HTMLElement) => {
    const app = createApp(ContentApp)
    app.mount(container)

    console.info('content_script configuration:', {
      rootId,
      containerClass,
      stylesheets
    })

    // Return cleanup function for unmounting (required)
    return () => {
      app.unmount()
    }
  }
}
