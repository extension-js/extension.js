import {mount} from 'svelte'
import ContentApp from './ContentApp.svelte'

// Import CSS to ensure webpack processes it as an asset
// This is required for content scripts to have CSS available
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
}: ContentScriptOptions) {
  return (container: HTMLElement) => {
    // Mount Svelte app using Svelte 5's mount function
    mount(ContentApp, {
      target: container
    })

    console.info('content_script configuration:', {
      rootId,
      containerClass,
      stylesheets
    })

    // Return cleanup function for unmounting (required)
    return () => {
      // Svelte doesn't have an unmount function, so we just return empty
    }
  }
}
