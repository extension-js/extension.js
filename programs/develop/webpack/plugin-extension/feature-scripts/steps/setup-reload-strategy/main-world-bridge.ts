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
 * - Validates message shape and restricts to same-origin-ish relative paths (no protocols)
 */
const EXTJS_MARK = '__extjs__'
const REQ_TYPE = 'EXTJS_WTW_LOAD'
const RES_TYPE = 'EXTJS_WTW_LOADED'

type Req = {
  [EXTJS_MARK]: true
  type: typeof REQ_TYPE
  requestId: string
  url: string
}

type Res = {
  [EXTJS_MARK]: true
  type: typeof RES_TYPE
  requestId: string
  ok: boolean
  error?: string
}

function safeString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0
}

function hasForbiddenProtocol(url: string) {
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
    if (typeof (globalThis as any).browser === 'object')
      return (globalThis as any).browser
  } catch {}
  try {
    if (typeof (globalThis as any).chrome === 'object')
      return (globalThis as any).chrome
  } catch {}
  return null
}

function resolveExtensionUrl(inputUrl: string): string | null {
  if (!safeString(inputUrl)) return null
  if (hasForbiddenProtocol(inputUrl)) return null

  // Already an extension URL
  if (/^((chrome|moz)-extension):\/\//.test(inputUrl)) return inputUrl

  const rt = getRuntime()
  const getURL = rt?.runtime?.getURL
  if (typeof getURL !== 'function') return null

  // Normalize to extension-relative path
  let path = inputUrl
  try {
    // If it's an absolute URL without forbidden scheme, keep as-is (handled above).
    // If it's something like "/file.js?x#y", keep only pathname.
    if (path.startsWith('/')) {
      path = new URL('https://example.invalid' + path).pathname
    } else if (path.includes('?') || path.includes('#')) {
      path = path.split('?')[0].split('#')[0]
    }
  } catch {
    // ignore parse errors, fall back to raw
  }

  if (!path) return null
  if (!path.startsWith('/')) path = '/' + path
  return String(getURL(path))
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    // Preserve execution order as much as possible
    ;(el as any).async = false
    el.onload = () => {
      try {
        el.remove()
      } catch {}
      resolve()
    }
    el.onerror = () => {
      try {
        el.remove()
      } catch {}
      reject(new Error('Failed to load script: ' + src))
    }
    ;(document.head || document.documentElement).appendChild(el)
  })
}

function postResponse(res: Res) {
  try {
    window.postMessage(res, '*')
  } catch {
    // ignore
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return
  const data = event.data as Partial<Req> | null
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
