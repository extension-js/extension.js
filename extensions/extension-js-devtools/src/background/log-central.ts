type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'

type ContextType =
  | 'background'
  | 'content'
  | 'page'
  | 'sidebar'
  | 'popup'
  | 'options'
  | 'devtools'

interface IncomingLogMessage {
  type: 'log'
  level: LogLevel
  messageParts: unknown[]
  context: ContextType
  url?: string
  stack?: string
  errorName?: string
  token?: string
}

interface SubscribeMessage {
  type: 'subscribe'
}

interface InitMessage {
  type: 'init'
  events: LogEvent[]
}

interface AppendMessage {
  type: 'append'
  event: LogEvent
}

type ClientMessage = IncomingLogMessage | SubscribeMessage
type ServerMessage = InitMessage | AppendMessage

interface LogEvent {
  id: string
  timestamp: number
  level: LogLevel
  context: ContextType
  messageParts: unknown[]
  url?: string
  stack?: string
  errorName?: string
  tabId?: number
  frameId?: number
  title?: string
  hostname?: string
  sourceExtensionId?: string
  incognito?: boolean
  windowId?: number
}

const MAX_EVENTS_ALL = 2000
const MAX_EVENTS_PER_TAB = 1000
const eventsBufferAll: LogEvent[] = []
const perTabBuffers = new Map<number, LogEvent[]>()
const subscribers = new Set<chrome.runtime.Port>()
let captureStacks = false
let externalToken: string | null = null

// Load settings
try {
  chrome.storage.session.get(['logger_capture_stacks'], (data) => {
    captureStacks = Boolean(data?.logger_capture_stacks)
  })

  const onSessionChanged = (
    changes: {[key: string]: chrome.storage.StorageChange},
    areaName: 'session' | 'local' | 'sync'
  ) => {
    if (areaName === 'session' && 'logger_capture_stacks' in changes) {
      captureStacks = Boolean(changes.logger_capture_stacks?.newValue)
    }
  }
  chrome.storage.session.onChanged.addListener(onSessionChanged as never)
} catch {}

// Load external token (optional hardening)
try {
  chrome.storage.local.get(['logger_external_token'], (data) => {
    if (typeof data?.logger_external_token === 'string')
      externalToken = data.logger_external_token
  })
  const onLocalChanged = (
    changes: {[key: string]: chrome.storage.StorageChange},
    area: 'local' | 'sync' | 'session'
  ) => {
    if (area === 'local' && 'logger_external_token' in changes) {
      const nv = changes.logger_external_token?.newValue
      externalToken = typeof nv === 'string' ? nv : null
    }
  }
  chrome.storage.onChanged.addListener(onLocalChanged as never)
} catch {}

function uuid(): string {
  // Simple UUID v4-ish for event IDs
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

let isInternalConsoleWrite = false

function appendEventAndBroadcast(event: LogEvent) {
  eventsBufferAll.push(event)
  if (eventsBufferAll.length > MAX_EVENTS_ALL) eventsBufferAll.shift()

  if (typeof event.tabId === 'number') {
    const buf = perTabBuffers.get(event.tabId) || []
    buf.push(event)
    if (buf.length > MAX_EVENTS_PER_TAB) buf.shift()
    perTabBuffers.set(event.tabId, buf)
  }
  // Do not mirror into background console to avoid self-noise
  // Broadcast to subscribers (e.g., sidebar)
  for (const port of subscribers) {
    try {
      const msg: ServerMessage = {type: 'append', event}
      port.postMessage(msg)
    } catch {}
  }
}

function handleClientMessage(port: chrome.runtime.Port, msg: ClientMessage) {
  if (msg.type === 'subscribe') {
    subscribers.add(port)
    const initMsg: InitMessage = {type: 'init', events: eventsBufferAll}
    try {
      port.postMessage(initMsg)
    } catch {}
    return
  }

  // Ignore self logs (only accept user extension logs)
  const senderExtensionId = port.sender?.id
  if (senderExtensionId && senderExtensionId === chrome.runtime.id) return

  const senderTabId = port.sender?.tab?.id
  const senderFrameId = port.sender?.frameId
  const incognito = port.sender?.tab?.incognito
  const windowId = port.sender?.tab?.windowId
  // Per-sender rate limiting (optional hardening)
  const rateKey = senderExtensionId || `tab:${senderTabId ?? 'unknown'}`
  if (!allowRate(rateKey)) return

  const sanitizedParts = sanitizeParts(msg.messageParts)
  const event: LogEvent = {
    id: uuid(),
    timestamp: Date.now(),
    level: msg.level,
    context: msg.context,
    messageParts: sanitizedParts,
    url: msg.url,
    stack: msg.stack,
    errorName: msg.errorName,
    tabId: senderTabId,
    frameId: senderFrameId,
    sourceExtensionId: senderExtensionId,
    incognito,
    windowId
  }

  enrichEventAndBroadcast(event)
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'logger') return
  const onMessage = (msg: ClientMessage) => handleClientMessage(port, msg)
  port.onMessage.addListener(onMessage)
  port.onDisconnect.addListener(() => {
    subscribers.delete(port)
    try {
      port.onMessage.removeListener(onMessage)
    } catch {}
  })
})

// Accept logs from other extensions (manager mode)
try {
  chrome.runtime.onConnectExternal.addListener((port) => {
    if (port.name !== 'logger') return
    if (port.sender?.id && port.sender.id === chrome.runtime.id) return
    const onMessage = (msg: ClientMessage) => {
      // Enforce token if configured
      if (externalToken && (msg as any)?.token !== externalToken) return
      handleClientMessage(port, msg)
    }
    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(() => {
      subscribers.delete(port)
      try {
        port.onMessage.removeListener(onMessage)
      } catch {}
    })
  })
  chrome.runtime.onMessageExternal.addListener(
    (msg: unknown, sender, sendResponse) => {
      try {
        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as {type?: string}).type === 'log'
        ) {
          if (sender?.id && sender.id === chrome.runtime.id) return false
          if (externalToken && (msg as any)?.token !== externalToken)
            return false
          const fakePort = {sender} as chrome.runtime.Port
          handleClientMessage(fakePort, msg as ClientMessage)
          sendResponse?.({ok: true})
          return true
        }

        // Allow other listeners (e.g., dev reload client) to handle non-log messages.
        return false
      } catch {
        return false
      }
    }
  )
} catch {}

chrome.action.onClicked.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
  } catch {}
})

// Recent dedupe to avoid accidental duplicates
const recentKeys: string[] = []
const recentSet = new Set<string>()

function computeKey(event: LogEvent): string {
  const base = `${event.level}|${event.context}|${event.tabId ?? ''}|${event.frameId ?? ''}|${event.url ?? ''}|${safeJson(event.messageParts)}`
  return base.slice(0, 512)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function appendEventWithEnrich(event: LogEvent) {
  enrichEventAndBroadcast(event)
}

function enrichEventAndBroadcast(event: LogEvent) {
  const key = computeKey(event)
  if (recentSet.has(key)) return
  recentSet.add(key)
  recentKeys.push(key)
  if (recentKeys.length > 2000) {
    const old = recentKeys.shift()
    if (old) recentSet.delete(old)
  }

  // Enrich hostname/title if possible
  if (event.url && !event.hostname) {
    try {
      const url = new URL(event.url)
      event.hostname = `${url.hostname}${url.pathname}`
    } catch {}
  }
  if (event.tabId != null && event.title == null) {
    try {
      chrome.tabs.get(event.tabId, (tab) => {
        if (chrome.runtime.lastError) return appendEventAndBroadcast(event)
        event.title = tab?.title || event.title
        appendEventAndBroadcast(event)
      })
      return
    } catch {}
  }

  appendEventAndBroadcast(event)
}

// Public entry-point for other background modules (e.g., page logs via chrome.debugger)
export function appendExternalLog(partial: {
  level: LogLevel
  context: ContextType
  messageParts: unknown[]
  url?: string
  tabId?: number
  frameId?: number
  stack?: string
  errorName?: string
}) {
  const event: LogEvent = {
    id: uuid(),
    timestamp: Date.now(),
    level: partial.level,
    context: partial.context,
    messageParts: sanitizeParts(partial.messageParts || []),
    url: partial.url,
    stack: partial.stack,
    errorName: partial.errorName,
    tabId: partial.tabId,
    frameId: partial.frameId
  }

  appendEventWithEnrich(event)
}
// Rate limit map (per sender)
const RATE_WINDOW_MS = 1000
const RATE_LIMIT = 200
const rateMap = new Map<string, {ts: number; count: number}>()

function allowRate(key: string): boolean {
  const now = Date.now()
  const entry = rateMap.get(key)

  if (!entry) {
    rateMap.set(key, {ts: now, count: 1})
    return true
  }

  if (now - entry.ts > RATE_WINDOW_MS) {
    entry.ts = now
    entry.count = 1
    return true
  }

  entry.count += 1

  if (entry.count > RATE_LIMIT) return false
  return true
}

function truncate(str: string, max = 2048): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '...'
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    try {
      return String(value)
    } catch {
      return '[unserializable]'
    }
  }
}

function sanitizeParts(parts: unknown[]): unknown[] {
  try {
    const out: string[] = []
    for (const p of parts ?? []) {
      if (typeof p === 'string') {
        out.push(truncate(p))
      } else if (p instanceof Error) {
        out.push(truncate(`${p.name}: ${p.message}`))
      } else {
        out.push(truncate(safeStringify(p)))
      }
      if (out.join(' ').length > 8192) break
    }
    return out
  } catch {
    return [safeStringify(parts)]
  }
}

function logLifecycle(
  level: LogLevel,
  parts: unknown[],
  meta: Partial<LogEvent> = {}
) {
  const event: LogEvent = {
    id: uuid(),
    timestamp: Date.now(),
    level,
    context: 'background',
    messageParts: parts,
    url: typeof meta.url === 'string' ? meta.url : undefined,
    tabId: typeof meta.tabId === 'number' ? meta.tabId : undefined,
    frameId: typeof meta.frameId === 'number' ? meta.frameId : undefined
  }
  appendEventWithEnrich(event)
}

// Extension lifecycle
chrome.runtime.onInstalled.addListener((details) => {
  logLifecycle('info', [
    'extension installed',
    details.reason,
    details.previousVersion ?? null
  ])
})

// Persist/restore last events to survive SW restarts
chrome.storage.session.get(['logger_events'], (data) => {
  const saved = Array.isArray(data?.logger_events)
    ? (data.logger_events as LogEvent[])
    : []
  if (saved.length) {
    for (const ev of saved.slice(-MAX_EVENTS_ALL)) {
      eventsBufferAll.push(ev)
    }
  }
})

setInterval(() => {
  chrome.storage.session.set({logger_events: eventsBufferAll.slice(-200)})
}, 2000)

chrome.runtime.onStartup.addListener(() => {
  logLifecycle('info', ['extension startup'])
  // Emit a deterministic test signal for CLI verification
  try {
    logLifecycle('info', ['TEST_LOG: background-start'])
  } catch {}
})

// Tabs lifecycle
chrome.tabs.onCreated.addListener((tab) => {
  logLifecycle('info', ['tab created'], {
    tabId: tab.id ?? undefined,
    url: tab.url
  })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    logLifecycle('debug', ['tab loading'], {tabId, url: tab.url})
  }
  if (changeInfo.status === 'complete') {
    logLifecycle('debug', ['tab complete'], {tabId, url: tab.url})
  }
  if (typeof changeInfo.url === 'string') {
    logLifecycle('info', ['tab url changed', changeInfo.url], {
      tabId,
      url: changeInfo.url
    })
  }
})

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  logLifecycle(
    'info',
    [
      'tab removed',
      {
        windowId: removeInfo.windowId,
        isWindowClosing: removeInfo.isWindowClosing
      }
    ],
    {tabId}
  )
})

// These require "webNavigation" permission
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return
  logLifecycle('info', ['Before navigate'], {
    tabId: details.tabId,
    frameId: details.frameId,
    url: details.url,
    title: '[navigation]'
  })
})

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return
  logLifecycle('info', ['Navigation committed'], {
    tabId: details.tabId,
    frameId: details.frameId,
    url: details.url,
    title: '[navigation]'
  })
})

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return
  logLifecycle('info', ['Navigation completed'], {
    tabId: details.tabId,
    frameId: details.frameId,
    url: details.url,
    title: '[navigation]'
  })
})

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) return
  logLifecycle('error', ['Navigation error', details.error], {
    tabId: details.tabId,
    frameId: details.frameId,
    url: details.url,
    title: '[navigation]'
  })
})

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  // Covers SPA route changes
  if (details.frameId !== 0) return
  logLifecycle('info', ['History state updated'], {
    tabId: details.tabId,
    frameId: details.frameId,
    url: details.url,
    title: '[navigation]'
  })
})

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  const m = msg as {type?: string}

  if (m && m.type === 'get-events') {
    sendResponse({events: eventsBufferAll.slice(-500)})
    return true
  }

  if (m && m.type === 'clear-events') {
    eventsBufferAll.length = 0
    sendResponse({ok: true})

    return true
  }

  return false
})
