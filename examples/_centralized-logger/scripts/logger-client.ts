import type {LoggerContext, LogLevel} from '@/types/logger'

// This function is used to setup the logger client in the extension context.
// Users should call this function in the extension context they want to log from
// via import or script injection. e.g. in content/scripts.tsx
// ```ts
// import {setupLoggerClient} from 'chrome-extension://<extension-id>/scripts/logger-client.js'
// setupLoggerClient('content')
// ```
export function setupLoggerClient(
  contextOrOptions:
    | LoggerContext
    | {
        context: LoggerContext
        targetExtensionId?: string
        captureStacks?: boolean
        token?: string
      }
) {
  try {
    const opts =
      typeof contextOrOptions === 'string'
        ? {
            context: contextOrOptions,
            targetExtensionId: undefined,
            captureStacks: false,
            token: undefined
          }
        : contextOrOptions || {
            context: 'content',
            targetExtensionId: undefined,
            captureStacks: false,
            token: undefined
          }
    const context = opts.context
    const targetExtensionId = opts.targetExtensionId
    let captureStacks = Boolean(opts.captureStacks)
    const token = opts.token

    try {
      chrome.storage?.session?.get?.(['logger_capture_stacks'], (data) => {
        if (typeof data?.logger_capture_stacks === 'boolean') {
          captureStacks = data.logger_capture_stacks
        }
      })
      const onSessionChanged = (
        changes: {[key: string]: chrome.storage.StorageChange},
        area: 'session' | 'local' | 'sync'
      ) => {
        if (area === 'session' && 'logger_capture_stacks' in changes) {
          captureStacks = Boolean(changes.logger_capture_stacks?.newValue)
        }
      }
      ;(chrome.storage as any)?.session?.onChanged?.addListener?.(
        onSessionChanged
      )
    } catch {}

    const port = targetExtensionId
      ? chrome.runtime.connect(targetExtensionId, {name: 'logger'})
      : chrome.runtime.connect({name: 'logger'})

    function post(
      level: LogLevel,
      parts: unknown[],
      extra?: {stack?: string; errorName?: string}
    ) {
      try {
        port.postMessage({
          type: 'log',
          level,
          messageParts: parts,
          context,
          url: location.href,
          stack: extra?.stack,
          errorName: extra?.errorName,
          token
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
        const stack = captureStacks
          ? (event as unknown as {error?: {stack?: string}})?.error?.stack ||
            new Error().stack
          : undefined
        post('error', [event.message], {stack, errorName: 'Error'})
      } catch {}
    })

    window.addEventListener('unhandledrejection', (event) => {
      try {
        const reason: any = (event as any)?.reason
        const stack = captureStacks
          ? (reason &&
            typeof reason === 'object' &&
            typeof reason.stack === 'string'
              ? reason.stack
              : new Error(String(reason)).stack) || undefined
          : undefined
        const errorName =
          reason &&
          typeof reason === 'object' &&
          typeof reason.name === 'string'
            ? reason.name
            : 'UnhandledRejection'
        post('error', ['unhandledrejection', String(reason)], {
          stack,
          errorName
        })
      } catch {}
    })

    // Tear-down signals
    window.addEventListener(
      'pagehide',
      () => {
        try {
          post('info', ['pagehide'])
        } catch {}
      },
      {capture: true}
    )

    document.addEventListener(
      'visibilitychange',
      () => {
        try {
          if (document.visibilityState === 'hidden')
            post('info', ['visibility:hidden'])
        } catch {}
      },
      {capture: true}
    )
  } catch {}
}
