import colors from 'pintor'
import type {
  Controller,
  ChromiumLogger,
  CdpEvent,
  ConsoleAPICalledEvent,
  LogEntryAddedEvent,
  LogLevel
} from '../chromium-types'

export async function setupUnifiedLogging(
  controller: Controller,
  opts: ChromiumLogger
) {
  const level = String(opts.level || '').toLowerCase()
  if (!level || level === 'off') return

  const colorOn = opts?.color !== false
  const c = {
    gray: (s: string) => (colorOn && colors.gray ? colors.gray(s) : s),
    red: (s: string) => (colorOn && colors.red ? colors.red(s) : s),
    yellow: (s: string) =>
      colorOn && colors.brightYellow ? colors.brightYellow(s) : s,
    cyan: (s: string) => (colorOn && colors.cyan ? colors.cyan(s) : s),
    magenta: (s: string) => (colorOn && colors.magenta ? colors.magenta(s) : s),
    white: (s: string) => (colorOn && colors.white ? colors.white(s) : s)
  }

  await controller.enableUnifiedLogging({
    level: level as LogLevel,
    contexts: opts.contexts,
    urlFilter: opts.urlFilter,
    tabFilter: opts.tabFilter
  })

  const recentKeys = new Map<string, number>()
  const DEDUPE_MS = 1000

  const subscribe = controller.onProtocolEvent

  if (!subscribe) return

  subscribe((rawEvt) => {
    try {
      const evt = rawEvt as CdpEvent
      const showTs = opts.timestamps !== false
      const method = evt?.method
      let level = 'info'
      let text = ''
      let url = ''
      let line = 0
      let col = 0

      if (method === 'Runtime.consoleAPICalled') {
        const p = (evt as ConsoleAPICalledEvent).params || {}
        level = String(p.type || 'log').toLowerCase()
        const args = p.args || []
        const first = args[0]
        text = String(
          (first && ((first as any).value || (first as any).description)) || ''
        )
        const loc = p.stackTrace?.callFrames?.[0]

        if (loc) {
          url = String(loc.url || '')
          line = Number(loc.lineNumber || 0)
          col = Number(loc.columnNumber || 0)
        }
      } else if (method === 'Log.entryAdded') {
        const entry = (evt as LogEntryAddedEvent).params?.entry
        if (!entry) return

        level = String(entry.level || 'info').toLowerCase()
        text = String(entry.text || '')
        url = String(entry.url || '')
        line = Number(entry.lineNumber || 0)
        col = Number(entry.columnNumber || 0)
      } else {
        return
      }

      // Granular context mapping aligned with centralized DevTools UI
      const context = (() => {
        const u = String(url || '')
        if (u.startsWith('chrome-extension://')) {
          // Recognize emitted content script artefacts under extension URLs
          if (
            /\bcontent_scripts\/content-\d+\.js\b/i.test(u) ||
            /\b\/content\/script/i.test(u)
          )
            return 'content'
          if (/\bbackground\//i.test(u) || /\bservice_worker\.js$/i.test(u))
            return 'background'
          if (/\bdevtools\//i.test(u)) return 'devtools'
          if (/\boptions\//i.test(u)) return 'options'
          if (/(^|\/)action\//i.test(u) || /\bpopup\//i.test(u)) return 'popup'
          if (/\b(sidebar|side_panel)\//i.test(u)) return 'sidebar'
          return 'background'
        }

        // Heuristic for content scripts when URL points to page but content artefacts mentioned
        if (/\bcontent(_scripts)?\b/i.test(u) || /\bcontent[-_/]/i.test(text)) {
          return 'content'
        }

        return 'page'
      })()

      const prefix = '►►►'

      function fmtLevel(lvl: string) {
        const up = String(lvl || 'log').toUpperCase()
        switch (String(lvl || '').toLowerCase()) {
          case 'error':
            return c.red(up)
          case 'warn':
            return c.yellow(up)
          case 'info':
            return c.cyan(up)
          case 'debug':
            return c.magenta(up)
          case 'trace':
            return c.white(up)
          case 'log':
          default:
            return c.gray(up)
        }
      }

      const where = url ? `${url}:${line}:${col}` : ''
      const msg = text && text.trim().length ? text.trim() : '(none)'

      const key = `${method}|${level}|${context}|${where}|${msg}`
      const nowMs = Date.now()
      const last = recentKeys.get(key) || 0

      if (nowMs - last < DEDUPE_MS) return

      recentKeys.set(key, nowMs)

      if (recentKeys.size > 500) {
        const cutoff = nowMs - DEDUPE_MS
        for (const [k, t] of recentKeys) {
          if (t < cutoff) {
            recentKeys.delete(k)
          }
        }
      }

      const nowDate = new Date()
      const tsIso = showTs ? `${nowDate.toISOString()} ` : ''

      // JSON/NDJSON aligned output for machine parsing
      if (String(opts.format || '').toLowerCase() !== 'pretty') {
        const event = {
          timestamp: nowDate.toISOString(),
          level: String(level || 'log'),
          context,
          message: msg,
          url,
          line,
          column: col,
          tabId: opts.tabFilter ?? undefined
        }

        try {
          // For both json and ndjson we print one object per line
          console.log(JSON.stringify(event))
        } catch {
          // fallback to plain
          console.log(
            `${prefix} ${level} ${context} - ${msg}${where ? ' (' + where + ')' : ''}`
          )
        }
        return
      }

      // Pretty human output mirroring DevTools, Vercel tone
      const ctx = c.gray(`[${context}]`)
      const lvl = fmtLevel(level)
      const whereStr = where ? ` ${c.gray(where)}` : ''
      const message = msg && msg.trim().length ? msg.trim() : '(none)'
      console.log(`${tsIso}${prefix} ${ctx} ${lvl}${whereStr} - ${message}`)
    } catch {
      // Ignore
    }
  })
}
