/**
 * Preact Content Script with Wrapper
 *
 * This file provides the wrapper-based approach for consistent CSS HMR experience.
 * It uses the content script wrapper to provide the same API as other frameworks.
 */

import {render} from 'preact'
import ContentApp from './ContentApp'

// Import CSS to ensure webpack processes it as an asset
// This is required for content scripts to have CSS available
// import './styles.css'

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
    render(ContentApp(), container)

    console.info('content_script configuration:', {
      rootId,
      containerClass,
      stylesheets
    })

    // Return cleanup function for unmounting (required)
    return () => {
      // Preact doesn't have an unmount function, so we just return empty
    }
  }
}
