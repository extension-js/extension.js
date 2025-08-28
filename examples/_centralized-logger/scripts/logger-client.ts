import type {LoggerContext, LogLevel} from '@/types/logger'

// This function is used to setup the logger client in the extension context.
// Users should call this function in the extension context they want to log from
// via import or script injection. e.g. in content/scripts.tsx
// ```ts
// import {setupLoggerClient} from 'chrome-extension://<extension-id>/scripts/logger-client.js'
// setupLoggerClient('content')
// ```
export function setupLoggerClient(context: LoggerContext) {
  try {
    const port = chrome.runtime.connect({name: 'logger'})

    function post(level: LogLevel, parts: unknown[]) {
      try {
        port.postMessage({
          type: 'log',
          level,
          messageParts: parts,
          context,
          url: location.href
        })
      } catch {}
    }

    const levels: LogLevel[] = [
      'log',
      'info',
      'warn',
      'error',
      'debug',
      'trace'
    ]

    type ConsoleMethod = (...args: Parameters<typeof console.log>) => void
    const originals: Partial<Record<LogLevel, ConsoleMethod>> = {}

    for (const level of levels) {
      originals[level] = console[level]?.bind(console)
      console[level] = (...args) => {
        try {
          post(level, args)
        } catch {}
        originals[level]?.(...args)
      }
    }

    window.addEventListener('error', (event) => {
      try {
        post('error', [event.message])
      } catch {}
    })

    window.addEventListener('unhandledrejection', (event) => {
      try {
        post('error', ['unhandledrejection', String(event.reason)])
      } catch {}
    })
  } catch {}
}
