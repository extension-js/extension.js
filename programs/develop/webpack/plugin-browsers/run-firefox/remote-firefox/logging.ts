import colors from 'pintor'
import {printLogEventJson, printLogEventPretty} from '../firefox-utils'
import {MessagingClient} from './messaging-client'

export async function attachConsoleListeners(client: MessagingClient) {
  try {
    const targets = (await client.getTargets()) as Array<{
      actor?: string
      consoleActor?: string
      webConsoleActor?: string
      url?: string
    }>

    for (const t of targets || []) {
      try {
        const resolved = await client.getTargetFromDescriptor(
          String(t.actor || '')
        )
        const consoleActor =
          (resolved as any)?.consoleActor || t.consoleActor || t.webConsoleActor
        if (consoleActor) {
          try {
            await client.request({
              to: consoleActor,
              type: 'startListeners',
              listeners: ['ConsoleAPI', 'PageError', 'NetworkActivity']
            })
          } catch {
            // ignore startListeners failures (older actors)
          }
        }
      } catch {
        // ignore per-target failures
      }
    }
  } catch {
    // ignore target scan failures
  }
}

export function subscribeUnifiedLogging(
  client: MessagingClient,
  opts: {
    level?: string
    contexts?: string[] | undefined
    urlFilter?: string | undefined
    tabFilter?: string
    format?: 'pretty' | 'json' | 'ndjson'
    timestamps?: boolean
    color?: boolean
  }
) {
  const levelMap = ['trace', 'debug', 'log', 'info', 'warn', 'error']
  const wantLevel = String(opts.level || 'info').toLowerCase()
  const wantIdx = Math.max(0, levelMap.indexOf(wantLevel))
  const wantContexts = Array.isArray(opts.contexts)
    ? opts.contexts.map((s) => String(s))
    : undefined
  const urlFilter = String(opts.urlFilter || '')
  const tabFilter = opts.tabFilter || ''
  const fmt = (opts.format as 'pretty' | 'json' | 'ndjson') || 'pretty'
  const showTs = opts.timestamps !== false
  const color = !!opts.color
  const colorFns = {
    red: (s: string) => (colors.red ? colors.red(s) : s),
    yellow: (s: string) => (colors.brightYellow ? colors.brightYellow(s) : s),
    gray: (s: string) => (colors.gray ? colors.gray(s) : s),
    blue: (s: string) => (colors.blue ? colors.blue(s) : s)
  }

  client.on('message', (message) => {
    try {
      const type = String(message?.type || '')
      if (!type) return

      let level = 'info'
      let text = ''
      let url = ''
      let context:
        | 'page'
        | 'background'
        | 'content'
        | 'sidebar'
        | 'popup'
        | 'options'
        | 'devtools' = 'page'
      let tabId: number | undefined = undefined

      if (type === 'consoleAPICall' || type === 'logMessage') {
        const a = (message as any)?.message || message
        level = String(a.level || a.category || 'log').toLowerCase()
        const arg = (a.arguments && a.arguments[0]) || a.message || a.text
        text = String(
          (arg && (arg.value || arg.text || arg.message || arg)) || ''
        )
        url = String(a.filename || a.sourceName || '')
      } else if (type === 'pageError' || type === 'networkEventUpdate') {
        level = type === 'pageError' ? 'error' : 'info'
        text = String(
          (message as any)?.errorMessage || (message as any)?.cause || ''
        )
        url = String((message as any)?.url || (message as any)?.sourceURL || '')
      } else if (type === 'tabNavigated') {
        level = 'debug'
        text = String((message as any)?.url || '')
        url = String((message as any)?.url || '')
      } else {
        return
      }

      if (typeof url === 'string' && url.startsWith('moz-extension://')) {
        context = 'background'
      } else {
        context = 'page'
      }

      const idx = Math.max(0, levelMap.indexOf(level))
      if (idx < wantIdx) return

      if (
        wantContexts &&
        wantContexts.length &&
        !wantContexts.includes(context)
      )
        return

      if (urlFilter && !String(url || '').includes(urlFilter)) return

      const msgTab = String((message as any)?.from || '')
      if (tabFilter && msgTab && !msgTab.includes(tabFilter)) return

      const event = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: Date.now(),
        level,
        context,
        messageParts: [text],
        url,
        tabId
      }

      if (fmt === 'json' || fmt === 'ndjson') {
        printLogEventJson(event)
        return
      }

      printLogEventPretty(event, color, colorFns, showTs)
    } catch {
      // Ignore
    }
  })
}
