// CDP observer that subscribes to the dev tooling's launched Chrome and
// records ground-truth lifecycle events. Designed for use by the reload
// matrix: every event has a monotonic timestamp, a category, and the
// target/extension URL it came from. The harness diffs the resulting
// timeline against per-scenario expectations.
//
// The dev tooling already attaches a CDP client to the same browser. CDP
// supports multiple concurrent clients on the same debug port; this observer
// connects independently and never sends commands that mutate state, so it
// cannot interfere with the dev client. We use the http://host:port/json/list
// REST endpoint to discover the browser-level WebSocket URL, then attach over
// it as a passive listener.

import http from 'node:http'
import {WebSocket} from 'ws'

const SERVICE_WORKER_TYPES = new Set([
  'service_worker',
  'background_page',
  'worker'
])
const PAGE_TYPES = new Set(['page', 'iframe'])

function nowMs() {
  // Monotonic-ish timestamp from process start. We never compare across runs.
  const [seconds, nanoseconds] = process.hrtime()
  return seconds * 1_000 + nanoseconds / 1_000_000
}

function fetchBrowserDebuggerUrl(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {host, port, path: '/json/version', timeout: 3_000},
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          try {
            const data = JSON.parse(body)
            if (typeof data.webSocketDebuggerUrl === 'string') {
              resolve(data.webSocketDebuggerUrl)
            } else {
              reject(new Error('No webSocketDebuggerUrl in /json/version'))
            }
          } catch (err) {
            reject(err)
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('Timed out fetching /json/version'))
    })
  })
}

async function waitForDebuggerUrl(port, host, deadlineMs) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < deadlineMs) {
    try {
      return await fetchBrowserDebuggerUrl(port, host)
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw lastError || new Error('Debug URL never became available')
}

/**
 * Connect a passive CDP observer to a running Chrome instance.
 *
 * The observer records:
 *   - serviceWorkerCreated / serviceWorkerDestroyed: SW lifecycle for any
 *     chrome-extension:// origin. Each event carries the extension origin so
 *     we can filter to the user extension and ignore companions.
 *   - pageNavigated: any extension page reload (popup, options, devtools,
 *     newtab, sidebar, action). Equivalent to the user seeing that page
 *     refresh.
 *   - executionContextCreated: per-frame contexts. Used to detect content
 *     script re-injection into a tab without a full page reload.
 *
 * The returned object exposes:
 *   - events: live array of recorded events (read-only consumers should
 *     snapshot before reading).
 *   - close(): tear down WebSocket and child target sessions.
 */
export async function connectObserver({port, host = '127.0.0.1', deadlineMs = 15_000}) {
  const browserUrl = await waitForDebuggerUrl(port, host, deadlineMs)
  const ws = new WebSocket(browserUrl)

  const events = []
  const sessions = new Map()
  let messageId = 0
  const pending = new Map()
  let closed = false
  const closeWaiters = []

  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++messageId
      pending.set(id, {resolve, reject, method})
      const message = sessionId
        ? {id, sessionId, method, params}
        : {id, method, params}
      try {
        ws.send(JSON.stringify(message))
      } catch (err) {
        pending.delete(id)
        reject(err)
      }
    })
  }

  function record(category, payload) {
    events.push({
      timestamp: nowMs(),
      category,
      ...payload
    })
  }

  function deriveExtensionOrigin(url) {
    if (typeof url !== 'string') return undefined
    if (!url.startsWith('chrome-extension://')) return undefined
    const tail = url.slice('chrome-extension://'.length)
    const slash = tail.indexOf('/')
    return slash === -1 ? tail : tail.slice(0, slash)
  }

  ws.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (typeof message.id === 'number' && pending.has(message.id)) {
      const {resolve, reject} = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      return
    }

    const method = message.method
    if (!method) return
    const params = message.params || {}

    if (method === 'Target.attachedToTarget') {
      const sessionId = params.sessionId
      const info = params.targetInfo || {}
      sessions.set(sessionId, info)
      const origin = deriveExtensionOrigin(info.url)
      if (SERVICE_WORKER_TYPES.has(info.type) && origin) {
        record('serviceWorkerCreated', {
          sessionId,
          extensionOrigin: origin,
          targetUrl: info.url,
          targetType: info.type
        })
      }
      // Enable Page domain on page targets so we get frameNavigated events.
      if (PAGE_TYPES.has(info.type)) {
        send('Page.enable', {}, sessionId).catch(() => {})
      }
      // Enable Runtime everywhere so we capture context creation in tabs
      // (content-script reinjection signal).
      send('Runtime.enable', {}, sessionId).catch(() => {})
      return
    }

    if (method === 'Target.detachedFromTarget') {
      const sessionId = params.sessionId
      const info = sessions.get(sessionId)
      sessions.delete(sessionId)
      if (info) {
        const origin = deriveExtensionOrigin(info.url)
        if (SERVICE_WORKER_TYPES.has(info.type) && origin) {
          record('serviceWorkerDestroyed', {
            sessionId,
            extensionOrigin: origin,
            targetUrl: info.url,
            targetType: info.type
          })
        }
      }
      return
    }

    if (method === 'Target.targetInfoChanged') {
      const info = params.targetInfo || {}
      // Track URL changes for already-attached sessions (page navigations show
      // up here too, but Page.frameNavigated below is the authoritative one).
      for (const [sessionId, prev] of sessions.entries()) {
        if (prev.targetId === info.targetId) {
          sessions.set(sessionId, info)
          break
        }
      }
      return
    }

    if (method === 'Page.frameNavigated') {
      const frame = params.frame || {}
      const origin = deriveExtensionOrigin(frame.url)
      if (origin) {
        record('extensionPageNavigated', {
          sessionId: message.sessionId,
          extensionOrigin: origin,
          frameUrl: frame.url
        })
      }
      return
    }

    if (method === 'Runtime.executionContextCreated') {
      const ctx = params.context || {}
      const auxData = ctx.auxData || {}
      // We care about isolated worlds (content-script injections) into normal
      // web pages. The extension origin is in auxData.frameId resolution
      // territory; CDP doesn't surface the extensionId directly here but the
      // origin in ctx.origin reflects the page origin, not the extension.
      // For ground truth we record everything and let the matrix filter.
      record('executionContextCreated', {
        sessionId: message.sessionId,
        contextId: ctx.id,
        contextOrigin: ctx.origin,
        contextName: ctx.name,
        isDefault: !!auxData.isDefault,
        type: auxData.type
      })
      return
    }
  })

  ws.on('close', () => {
    closed = true
    for (const waiter of closeWaiters.splice(0)) waiter()
  })
  ws.on('error', () => {
    // We swallow errors; the harness inspects the events list for emptiness.
  })

  await new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  // Subscribe to target lifecycle. autoAttach is the catch-all that yields
  // attachedToTarget events for every existing and future target.
  await send('Target.setDiscoverTargets', {discover: true})
  await send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true
  })

  return {
    events,
    snapshot() {
      return events.slice()
    },
    /**
     * Open a new tab navigating to `url`. Used to put extension pages in an
     * "open" state so per-edit reloads of those pages are observable. Returns
     * the targetId so the caller can later close the tab via closeTarget.
     */
    async openTarget(url) {
      const result = await send('Target.createTarget', {url})
      return result?.targetId
    },
    /** Close a previously opened tab. Best-effort; throws are swallowed. */
    async closeTarget(targetId) {
      try {
        await send('Target.closeTarget', {targetId})
      } catch {}
    },
    /** Block until at least `count` events of `category` are recorded, or timeout. */
    async waitForCategory(category, count, timeoutMs) {
      const start = Date.now()
      while (
        events.filter((e) => e.category === category).length < count &&
        Date.now() - start < timeoutMs &&
        !closed
      ) {
        await new Promise((r) => setTimeout(r, 50))
      }
    },
    /** Block until no new events for `quietMs`, or until timeout. */
    async waitForQuiescence(quietMs, timeoutMs) {
      const start = Date.now()
      let lastSeen = events.length
      let lastChange = Date.now()
      while (Date.now() - start < timeoutMs && !closed) {
        await new Promise((r) => setTimeout(r, 50))
        if (events.length !== lastSeen) {
          lastSeen = events.length
          lastChange = Date.now()
          continue
        }
        if (Date.now() - lastChange >= quietMs) return
      }
    },
    async close() {
      if (closed) return
      try {
        ws.close()
      } catch {}
      await new Promise((resolve) => {
        if (closed) return resolve()
        closeWaiters.push(resolve)
      })
    }
  }
}
