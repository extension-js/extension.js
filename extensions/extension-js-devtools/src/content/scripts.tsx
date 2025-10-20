// The directive below tells Extension.js to inject the content
// script of this file into the shadow DOM of the host page and
// inject all CSS imports into it. This provides style isolation
// and prevents conflicts with the host page's styles.
// See https://extension.js.org/docs/content-scripts#use-shadow-dom
import ReactDOM from 'react-dom/client'
import {setupLoggerClient} from '@/scripts/logger-client'
import ContentApp from './ContentApp'

import '../../styles.css'

let unmount: () => void

if (import.meta.webpackHot) {
  import.meta.webpackHot?.accept()
  import.meta.webpackHot?.dispose(() => unmount?.())
}

if (document.readyState === 'complete') {
  unmount = initial() || (() => {})
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') unmount = initial() || (() => {})
  })
}

function initial() {
  // Host + Shadow DOM isolation
  const host = document.createElement('div')
  document.body.appendChild(host)
  const shadowRoot = host.attachShadow({mode: 'open'})

  // Inline CSS into shadow for isolation and HMR-friendly reloads
  const style = document.createElement('style')
  shadowRoot.appendChild(style)
  fetchCSS().then((css) => (style.textContent = css))
  if (import.meta.webpackHot) {
    import.meta.webpackHot?.accept('../shared/styles.css', () => {
      fetchCSS().then((css) => (style.textContent = css))
    })
  }

  // React mount container
  const container = document.createElement('div')
  shadowRoot.appendChild(container)

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

  // Mount React app
  const mountingPoint = ReactDOM.createRoot(container)
  mountingPoint.render(<ContentApp portalContainer={shadowRoot} />)

  return () => {
    try {
      window.removeEventListener('message', onWindowMessage)
      pagePort.disconnect()
    } catch {}
    mountingPoint.unmount()
    host.remove()
  }
}

async function fetchCSS() {
  const url = new URL('../shared/styles.css', import.meta.url)
  const res = await fetch(url)
  const css = await res.text()
  return res.ok ? css : Promise.reject(css)
}
