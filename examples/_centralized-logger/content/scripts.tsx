// The directive below tells Extension.js to inject the content
// script of this file into the shadow DOM of the host page and
// inject all CSS imports into it. This provides style isolation
// and prevents conflicts with the host page's styles.
// See https://extension.js.org/docs/content-scripts#use-shadow-dom
'use shadow-dom'

import ReactDOM from 'react-dom/client'
import ContentApp from './ContentApp'
import {setupLoggerClient} from '@/scripts/logger-client'
import './styles.css'

export interface ContentScriptOptions {
  rootElement?: string
  rootClassName?: string
}

export default function contentScript(_options: ContentScriptOptions = {}) {
  return (container: HTMLElement) => {
    // Initialize content logger client (console overrides + error forwarding)
    setupLoggerClient('content')

    // Bridge page -> content -> background (port-based)
    const pagePort = chrome.runtime.connect({name: 'logger'})
    const onWindowMessage = (ev: MessageEvent) => {
      const data = (ev?.data || {}) as any
      if (!data || data.__reactLogger !== true || data.type !== 'log') return
      try {
        pagePort.postMessage({
          type: 'log',
          level: data.level,
          messageParts: data.messageParts,
          context: 'page',
          url: data.url
        })
      } catch {}
    }
    window.addEventListener('message', onWindowMessage)

    // Inject a page script to capture in-page console (page context)
    try {
      const code = `(() => {
        const post = (level, parts) => {
          try {
            window.postMessage({ __reactLogger: true, type: 'log', level, messageParts: parts, context: 'page', url: location.href }, '*');
          } catch {}
        };
        const levels = ['log','info','warn','error','debug','trace'];
        const originals = {};
        for (const level of levels) {
          originals[level] = (console[level] || console.log).bind(console);
          console[level] = (...args) => { try { post(level, args); } catch {}; try { originals[level](...args); } catch {} };
        }
        window.addEventListener('error', (ev) => { try { post('error', [ev.message]); } catch {} });
        window.addEventListener('unhandledrejection', (ev) => { try { post('error', ['unhandledrejection', String(ev.reason)]); } catch {} });
        // Unload/visibility signals
        window.addEventListener('pagehide', () => { try { post('info', ['pagehide']); } catch {} }, { capture: true });
        document.addEventListener('visibilitychange', () => {
          try { if (document.visibilityState === 'hidden') post('info', ['visibility:hidden']); } catch {}
        }, { capture: true });
        // Emit a deterministic test line for CLI verification
        try { console.info('TEST_LOG: page-start'); } catch {}
      })();`

      const s = document.createElement('script')
      s.textContent = code
      const root = document.documentElement || document.head || document.body
      root.appendChild(s)
      s.remove()
    } catch {}

    const mountingPoint = ReactDOM.createRoot(container)
    const root = container.shadowRoot || undefined
    mountingPoint.render(<ContentApp portalContainer={root} />)

    return () => {
      try {
        window.removeEventListener('message', onWindowMessage)
        pagePort.disconnect()
      } catch {}
      mountingPoint.unmount()
    }
  }
}
