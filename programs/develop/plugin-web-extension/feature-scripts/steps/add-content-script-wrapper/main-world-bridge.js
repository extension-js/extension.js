// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

const EXTJS_MARK = '__extjs__'
const REQ_TYPE = 'EXTJS_WTW_LOAD'
const RES_TYPE = 'EXTJS_WTW_LOADED'
const EXTJS_BASE_ATTR = 'data-extjs-extension-base'
// Two extensions can share a page, so a Firefox build names the page global
// of this one. A build that names none publishes on the document only.
const EXTJS_PAGE_BASE_KEY =
  typeof __EXTJS_PAGE_BASE_GLOBAL__ === 'string'
    ? __EXTJS_PAGE_BASE_GLOBAL__
    : ''
// The document is shared the same way, so the attribute takes that key.
const EXTJS_PAGE_BASE_ATTR =
  typeof __EXTJS_PAGE_BASE_ATTRIBUTE__ === 'string'
    ? __EXTJS_PAGE_BASE_ATTRIBUTE__
    : EXTJS_BASE_ATTR

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

// Firefox names every frame of a MAIN world file by this source, and the
// space in it is what no sourceURL comment of a page script can spell.
const EXTJS_INJECTED_SOURCE = '<anonymous code>'
// The columns of line one the read that takes the base can sit in.
const EXTJS_TAKE_COLUMNS = 227

function publishOnDocument(base) {
  try {
    const docEl = document?.documentElement

    if (docEl && typeof docEl.setAttribute === 'function') {
      docEl.setAttribute(EXTJS_PAGE_BASE_ATTR, base)
    }
  } catch {
    // ignore
  }
}

// The source of the one frame under the getter, when that frame is the
// opening statement of a file the browser ran, and nothing otherwise.
function takingSource(stack, base) {
  const callers = String(stack || '')
    .split('\n')
    .filter((frame) => frame && !frame.includes(`@${base}`))
  if (callers.length !== 1) return ''

  const frame = /^@(.+):(\d+):(\d+)$/.exec(callers[0])
  if (!frame) return ''
  if (Number(frame[2]) !== 1) return ''
  if (Number(frame[3]) > EXTJS_TAKE_COLUMNS) return ''

  return frame[1]
}

// A page names a script by a URL or by a sourceURL comment that ends at
// the first space, so a source with a space in it is the browser's own.
function isBrowserNamed(source) {
  return (
    source.includes(' ') &&
    !/[:/]/.test(source) &&
    !source.includes(' > ') &&
    source !== 'debugger eval code'
  )
}

// Publishes the base as a getter on the page window that answers the file
// the browser injects next and reads as an empty string to the page.
function publishToInjectedFile(base) {
  try {
    const page = window.wrappedJSObject

    if (!EXTJS_PAGE_BASE_KEY) return false
    if (!page || typeof exportFunction !== 'function') return false

    // A stack that stops naming this file in the form the check reads
    // cannot tell a caller apart, so the document carries the base.
    const own = String(new Error().stack || '').split('\n')[0]
    if (!own.includes(`@${base}`) || !/:\d+:\d+$/.test(own)) return false

    let published = null
    let failedClosed = false

    const answer = () => {
      try {
        // A page that swapped the getter for a wrapper of its own is not
        // answered through it.
        const held = Object.getOwnPropertyDescriptor(page, EXTJS_PAGE_BASE_KEY)
        if (!published || !held || held.get !== published) return ''

        const source = takingSource(new Error().stack, base)
        if (source === EXTJS_INJECTED_SOURCE) return base

        // The browser renamed its injected files, so the read that takes
        // the base gets it from the document, as it did before.
        if (source && !failedClosed && isBrowserNamed(source)) {
          failedClosed = true
          publishOnDocument(base)
        }
      } catch {
        // ignore
      }

      return ''
    }

    Object.defineProperty(page, EXTJS_PAGE_BASE_KEY, {
      get: exportFunction(answer, window),
      configurable: true,
      enumerable: false
    })

    const held = Object.getOwnPropertyDescriptor(page, EXTJS_PAGE_BASE_KEY)
    published = held && typeof held.get === 'function' ? held.get : null

    return published !== null
  } catch {
    // A page that defined the name first and locked it lands here.
    return false
  }
}

function setExtensionBaseUrl() {
  try {
    const rt = getRuntime()
    const getURL = rt?.runtime?.getURL
    if (typeof getURL !== 'function') return

    const base = String(getURL('/'))

    if (base && !publishToInjectedFile(base)) publishOnDocument(base)
  } catch {
    // ignore
  }
}

setExtensionBaseUrl()

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
      p = new URL(`https://example.invalid${p}`).pathname
    } else if (p.includes('?') || p.includes('#')) {
      p = p.split('?')[0].split('#')[0]
    }
  } catch {
    // ignore parse errors, fall back to raw
  }

  if (!p) return null
  if (!p.startsWith('/')) p = `/${p}`

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

      reject(new Error(`Failed to load script: ${src}`))
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

// On Firefox the extension URL is what the page must not learn, and a
// script element carrying it is one the page can read, so nothing loads.
function loadsFilesForThePage() {
  try {
    const getURL = getRuntime()?.runtime?.getURL

    return !(
      typeof getURL === 'function' &&
      String(getURL('/')).startsWith('moz-extension:')
    )
  } catch {
    return true
  }
}

function answerLoadRequest(event) {
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
}

if (loadsFilesForThePage()) {
  window.addEventListener('message', answerLoadRequest)
}
