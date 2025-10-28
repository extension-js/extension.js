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
        captureNetwork?: 'off' | 'errors'
      }
) {
  try {
    const opts =
      typeof contextOrOptions === 'string'
        ? {
            context: contextOrOptions,
            targetExtensionId: undefined,
            captureStacks: false,
            captureNetwork: 'off'
          }
        : contextOrOptions || {
            context: 'content',
            targetExtensionId: undefined,
            captureStacks: false,
            captureNetwork: 'off'
          }
    const context = opts.context
    const targetExtensionId = opts.targetExtensionId
    let captureStacks = Boolean(opts.captureStacks)
    let networkMode: 'off' | 'errors' = (opts as any)?.captureNetwork || 'off'

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
          errorName: extra?.errorName
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

    // Observe session setting for network capture and stacks
    try {
      chrome.storage?.session?.get?.(
        ['logger_capture_network', 'logger_capture_stacks'],
        (data) => {
          try {
            const v = String(data?.logger_capture_network || networkMode)
            networkMode = v === 'errors' ? 'errors' : 'off'
            if (typeof data?.logger_capture_stacks === 'boolean') {
              captureStacks = data.logger_capture_stacks
            }
          } catch {}
        }
      )
      const onSessionChanged = (
        changes: {[key: string]: chrome.storage.StorageChange},
        area: 'session' | 'local' | 'sync'
      ) => {
        try {
          if (area === 'session' && 'logger_capture_network' in changes) {
            const nv = String(
              changes.logger_capture_network?.newValue || networkMode
            )
            networkMode = nv === 'errors' ? 'errors' : 'off'
          }
          if (area === 'session' && 'logger_capture_stacks' in changes) {
            captureStacks = Boolean(changes.logger_capture_stacks?.newValue)
          }
        } catch {}
      }
      ;(chrome.storage as any)?.session?.onChanged?.addListener?.(
        onSessionChanged
      )
    } catch {}

    // Network errors-only capture wrappers (posting gated by networkMode)
    {
      try {
        // fetch wrapper
        const origFetch = (window as any).fetch?.bind(window)
        if (typeof origFetch === 'function') {
          ;(window as any).fetch = async (...args: any[]) => {
            const start = performance.now()
            try {
              const res = await origFetch(...args)
              if (networkMode === 'errors' && (!res || res.status >= 400)) {
                const reqUrl = String(args?.[0] ?? '')
                post('error', [
                  '[network]',
                  reqUrl,
                  res ? res.status : 'fetch failed',
                  res ? res.statusText || '' : '',
                  `${Math.round(performance.now() - start)}ms`
                ])
              }
              return res
            } catch (e: any) {
              const reqUrl = String(args?.[0] ?? '')
              if (networkMode === 'errors') {
                post('error', [
                  '[network]',
                  reqUrl,
                  'fetch failed',
                  String(e?.message || e)
                ])
              }
              throw e
            }
          }
        }

        // XHR wrapper
        const X: any = (window as any).XMLHttpRequest
        if (X && X.prototype) {
          const open = X.prototype.open
          const send = X.prototype.send
          X.prototype.open = function (
            method: string,
            url: string,
            ...rest: any[]
          ) {
            try {
              ;(this as any).__ext_url = url
              ;(this as any).__ext_method = method
            } catch {}
            return open.apply(this, [method, url, ...rest])
          }
          X.prototype.send = function (...args: any[]) {
            const start = performance.now()
            try {
              this.addEventListener('loadend', () => {
                try {
                  const status = (this as any).status
                  const url = (this as any).__ext_url || ''
                  if (
                    networkMode === 'errors' &&
                    (typeof status !== 'number' ||
                      status >= 400 ||
                      status === 0)
                  ) {
                    post('error', [
                      '[network]',
                      url,
                      status,
                      `${Math.round(performance.now() - start)}ms`
                    ])
                  }
                } catch {}
              })
            } catch {}
            try {
              return send.apply(this, args)
            } catch (e: any) {
              const url = (this as any).__ext_url || ''
              if (networkMode === 'errors') {
                post('error', [
                  '[network]',
                  url,
                  'xhr failed',
                  String(e?.message || e)
                ])
              }
              throw e
            }
          }
        }
      } catch {}
    }
  } catch {}
}
