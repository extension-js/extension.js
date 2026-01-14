// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

/**
 * Isolated-world bridge for MAIN world content scripts.
 *
 * Why: MAIN world scripts cannot access extension APIs (chrome/browser).
 * This bridge runs in the default (isolated) world and can:
 * - resolve extension URLs via runtime.getURL
 * - inject extension chunk scripts into the page (MAIN world) via <script src>
 *
 * Security notes:
 * - Only handles messages originating from the same window (event.source === window)
 * - Validates message shape and restricts to extension URLs or relative paths
 */
const EXTJS_MARK = '__extjs__'
const REQ_TYPE = 'EXTJS_WTW_LOAD'
const RES_TYPE = 'EXTJS_WTW_LOADED'

function safeString(x) {
  return typeof x === 'string' && x.length > 0
}

function hasForbiddenProtocol(url) {
  // We only accept:
  // - extension URLs (chrome-extension://..., moz-extension://...)
  // - relative paths (no scheme)
  return (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) &&
    !/^((chrome|moz)-extension):\/\//.test(url)
  )
}

function getRuntime() {
  // Prefer browser.* (Firefox), fallback to chrome.* (Chromium).
  // Do not throw if missing.
  try {
    if (typeof globalThis.browser === 'object') return globalThis.browser
  } catch {
    // Ignore
  }
  try {
    if (typeof globalThis.chrome === 'object') return globalThis.chrome
  } catch {
    // Ignore
  }
  return null
}

function resolveExtensionUrl(inputUrl) {
  if (!safeString(inputUrl)) return null
  if (hasForbiddenProtocol(inputUrl)) return null

  // Already an extension URL
  if (/^((chrome|moz)-extension):\/\//.test(inputUrl)) return inputUrl

  const rt = getRuntime()
  const getURL = rt?.runtime?.getURL
  if (typeof getURL !== 'function') return null

  // Normalize to extension-relative path
  let p = inputUrl
  try {
    // If it's something like "/file.js?x#y", keep only pathname.
    if (p.startsWith('/')) {
      p = new URL('https://example.invalid' + p).pathname
    } else if (p.includes('?') || p.includes('#')) {
      p = p.split('?')[0].split('#')[0]
    }
  } catch {
    // ignore parse errors, fall back to raw
  }

  if (!p) return null
  if (!p.startsWith('/')) p = '/' + p
  return String(getURL(p))
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    // Preserve execution order as much as possible
    el.async = false
    el.onload = () => {
      try {
        el.remove()
      } catch {
        // Ignore
      }
      resolve()
    }
    el.onerror = () => {
      try {
        el.remove()
      } catch {
        // Ignore
      }
      reject(new Error('Failed to load script: ' + src))
    }
    ;(document.head || document.documentElement).appendChild(el)
  })
}

function postResponse(res) {
  try {
    window.postMessage(res, '*')
  } catch {
    // ignore
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || data[EXTJS_MARK] !== true) return
  if (data.type !== REQ_TYPE) return
  if (!safeString(data.requestId) || !safeString(data.url)) return

  const requestId = data.requestId
  const resolved = resolveExtensionUrl(data.url)
  if (!resolved) {
    postResponse({
      [EXTJS_MARK]: true,
      type: RES_TYPE,
      requestId,
      ok: false,
      error: 'No extension runtime available to resolve URL'
    })
    return
  }

  injectScript(resolved)
    .then(() => {
      postResponse({
        [EXTJS_MARK]: true,
        type: RES_TYPE,
        requestId,
        ok: true
      })
    })
    .catch((e) => {
      postResponse({
        [EXTJS_MARK]: true,
        type: RES_TYPE,
        requestId,
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      })
    })
})
