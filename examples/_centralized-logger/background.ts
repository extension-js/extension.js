// Background Log Hub: centralizes logs from all contexts (background, content, page, sidebar)

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
}

const MAX_EVENTS = 1000
const eventsBuffer: LogEvent[] = []
const subscribers = new Set<chrome.runtime.Port>()
let captureStacks = false

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
  eventsBuffer.push(event)
  if (eventsBuffer.length > MAX_EVENTS) eventsBuffer.shift()
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
    const initMsg: InitMessage = {type: 'init', events: eventsBuffer}
    try {
      port.postMessage(initMsg)
    } catch {}
    return
  }

  const senderTabId = port.sender?.tab?.id
  const senderFrameId = port.sender?.frameId
  const event: LogEvent = {
    id: uuid(),
    timestamp: Date.now(),
    level: msg.level,
    context: msg.context,
    messageParts: msg.messageParts,
    url: msg.url,
    stack: msg.stack,
    errorName: msg.errorName,
    tabId: senderTabId,
    frameId: senderFrameId
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
    const onMessage = (msg: ClientMessage) => handleClientMessage(port, msg)
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
