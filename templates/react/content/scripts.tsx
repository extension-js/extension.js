// The directive below tells Extension.js to inject the content
// script of this file into the shadow DOM of the host page and
// inject all CSS imports into it. This provides style isolation
// and prevents conflicts with the host page's styles.
// See https://extension.js.org/docs/content-scripts#use-shadow-dom
'use shadow-dom'

import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'
import './styles.css'

export interface ContentScriptOptions {
  rootElement?: string
  rootClassName?: string
}

export default function contentScript(_options: ContentScriptOptions = {}) {
  return (container: HTMLElement) => {
    const mountingPoint = ReactDOM.createRoot(container)

    mountingPoint.render(<ContentApp />)
    return () => {
      mountingPoint.unmount()
    }
  }
}
