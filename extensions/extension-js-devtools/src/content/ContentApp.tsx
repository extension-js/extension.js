import {useEffect, useMemo, useRef, useState} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {Button} from '@/components/ui/button'
import {ScrollArea} from '@/components/ui/scroll-area'
import type {LogLevel, LoggerContext} from '@/types/logger'
import {formatMessageParts} from '@/lib/logger'

export interface ContentAppProps {
  portalContainer?: ShadowRoot
}

interface LogEntry {
  id: number
  level: LogLevel
  context: LoggerContext
  message: string
  url?: string
  time: string
}

export default function ContentApp({portalContainer}: ContentAppProps) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const idRef = useRef(1)

  const errorCount = entries.filter((e) => e.level === 'error').length

  const addEntry = (
    level: LogLevel,
    context: LoggerContext,
    parts: unknown[],
    url?: string
  ) => {
    const next: LogEntry = {
      id: idRef.current++,
      level,
      context,
      message: formatMessageParts(parts),
      url,
      time: new Date().toISOString()
    }
    setEntries((prev) => {
      const updated = [...prev, next]
      return updated.slice(-100)
    })

    if (level === 'error') {
      setOpen(true)
    }
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data

      if (!data || !data.__reactLogger || data.type !== 'log' || !data.level) {
        return
      }

      addEntry(data.level, data.context || 'page', data.messageParts, data.url)
    }

    window.addEventListener('message', onMessage)

    const onError = (event: ErrorEvent) => {
      addEntry('error', 'content', [event.message], location.href)
    }

    const onRejection = (event: PromiseRejectionEvent) => {
      addEntry(
        'error',
        'content',
        ['unhandledrejection', String(event.reason)],
        location.href
      )
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    const originalError = console.error.bind(console)
    console.error = (...args: unknown[]) => {
      try {
        addEntry('error', 'content', args, location.href)
      } catch {}
      originalError(...args)
    }

    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)

      console.error = originalError
    }
  }, [])

  const grouped = useMemo(() => entries, [entries])

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal container={portalContainer}>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[2147483647] bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[2147483647] grid w-[calc(100vw-32px)] max-w-[720px] -translate-x-1/2 -translate-y-1/2 gap-4 border border-neutral-700 bg-neutral-900 p-6 text-neutral-100 shadow-[0_20px_48px_rgba(0,0,0,0.5)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg">
            <div>
              <h3 className="text-lg font-semibold leading-none tracking-tight text-red-400">
                Runtime errors on this page
              </h3>
              <p className="text-sm text-neutral-300">
                Latest logs from page and content contexts. Click outside to
                close.
              </p>
            </div>
            <div className="mt-2">
              <ScrollArea className="h-[320px] w-full rounded border border-neutral-800">
                <div className="space-y-3">
                  {grouped.length === 0 ? (
                    <div className="text-sm text-neutral-400">No logs yet.</div>
                  ) : (
                    grouped.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-md border border-neutral-800 bg-neutral-950 p-3"
                      >
                        <pre className="whitespace-pre-wrap break-words text-sm leading-snug">
                          {entry.message}
                        </pre>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                          <span
                            className={
                              'uppercase tracking-wide ' +
                              (entry.level === 'error' ? 'text-red-500' : '')
                            }
                          >
                            {entry.level}
                          </span>
                          <span>•</span>
                          <span>{entry.context}</span>
                          <span>•</span>
                          <span>
                            {new Date(entry.time).toLocaleTimeString()}
                          </span>
                          {entry.url ? (
                            <>
                              <span>•</span>
                              <span
                                className="truncate max-w-[60ch]"
                                title={entry.url}
                              >
                                {entry.url}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="fixed left-4 bottom-4 z-[99999]">
        <Button
          onClick={() => setOpen(true)}
          className="relative rounded-full bg-neutral-900 border border-neutral-700 text-neutral-300 shadow hover:bg-neutral-800"
          size="icon"
          variant="secondary"
          aria-label={
            errorCount > 0 ? `Show errors (${errorCount})` : 'Show logs'
          }
          title={errorCount > 0 ? `Show errors (${errorCount})` : 'Show logs'}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={errorCount > 0 ? 'text-red-500' : 'text-neutral-400'}
          >
            <path
              fill="currentColor"
              d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Zm1 14h-2v-2h2v2Zm0-4h-2V6h2v6Z"
            />
          </svg>
          {errorCount > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] leading-5 text-center">
              {errorCount > 99 ? '99+' : errorCount}
            </span>
          ) : null}
        </Button>
      </div>
    </>
  )
}
