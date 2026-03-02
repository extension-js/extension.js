import {useEffect, useMemo, useRef, useState} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {Button} from '@/components/ui/button'
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

type LocalNetworkStatus =
  | 'checking'
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'unsupported'
  | 'error'

type UserExtensionStatus =
  | 'checking'
  | 'enabled'
  | 'disabled'
  | 'missing'
  | 'error'

const DialogOverlay = DialogPrimitive.Overlay as any
const DialogContent = DialogPrimitive.Content as any

export default function ContentApp({portalContainer}: ContentAppProps) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [localNetworkStatus, setLocalNetworkStatus] =
    useState<LocalNetworkStatus>('checking')
  const [userExtensionStatus, setUserExtensionStatus] =
    useState<UserExtensionStatus>('checking')
  const [userExtensionName, setUserExtensionName] = useState<string>('')
  const idRef = useRef(1)
  const autoOpenedRef = useRef(false)

  const errorCount = entries.filter((e) => e.level === 'error').length
  const diagnosticsIssueCount =
    (localNetworkStatus !== 'granted' ? 1 : 0) +
    (userExtensionStatus !== 'enabled' ? 1 : 0)

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
  const diagnosticsIssueLabel =
    diagnosticsIssueCount === 1
      ? '1 setup check needs attention'
      : `${diagnosticsIssueCount} setup checks need attention`

  useEffect(() => {
    let mounted = true

    const refreshLocalNetworkStatus = async () => {
      try {
        if (!navigator.permissions?.query) {
          if (!mounted) return
          setLocalNetworkStatus('unsupported')
          return
        }

        const status = await navigator.permissions.query({
          name: 'local-network-access' as PermissionName
        })
        if (!mounted) return

        const value = String(status.state || '').toLowerCase()
        if (value === 'granted') setLocalNetworkStatus('granted')
        else if (value === 'prompt') setLocalNetworkStatus('prompt')
        else if (value === 'denied') setLocalNetworkStatus('denied')
        else setLocalNetworkStatus('error')
      } catch {
        if (!mounted) return
        setLocalNetworkStatus('unsupported')
      }
    }

    const refreshUserExtensionStatus = async () => {
      try {
        const response = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({type: 'get-dx-status'}, resolve)
        })

        if (!mounted) return
        if (!response?.ok) {
          setUserExtensionStatus('error')
          return
        }

        setUserExtensionName(String(response.extensionName || ''))

        if (response.extensionEnabled === true) {
          setUserExtensionStatus('enabled')
        } else if (response.extensionEnabled === false) {
          setUserExtensionStatus('disabled')
        } else {
          setUserExtensionStatus('missing')
        }
      } catch {
        if (!mounted) return
        setUserExtensionStatus('error')
      }
    }

    refreshLocalNetworkStatus()
    refreshUserExtensionStatus()

    const onFocus = () => {
      refreshLocalNetworkStatus()
      refreshUserExtensionStatus()
    }

    window.addEventListener('focus', onFocus)
    const intervalId = window.setInterval(onFocus, 7000)

    return () => {
      mounted = false
      window.removeEventListener('focus', onFocus)
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (autoOpenedRef.current) return
    if (
      localNetworkStatus === 'checking' ||
      userExtensionStatus === 'checking'
    ) {
      return
    }

    const shouldAutoOpen =
      localNetworkStatus !== 'granted' || userExtensionStatus !== 'enabled'
    if (!shouldAutoOpen) return

    setOpen(true)
    autoOpenedRef.current = true
  }, [localNetworkStatus, userExtensionStatus])

  const localNetworkDescription =
    localNetworkStatus === 'granted'
      ? 'Local network access for this site is allowed.'
      : localNetworkStatus === 'prompt'
      ? 'Chrome will prompt on first local-network request. Click Allow when asked.'
      : localNetworkStatus === 'denied'
      ? 'Local network access for this site is blocked. Re-enable it in site settings.'
      : localNetworkStatus === 'checking'
      ? 'Checking local network permission...'
      : 'Could not read local network permission on this page.'

  const userExtensionDescription =
    userExtensionStatus === 'enabled'
      ? `${userExtensionName || 'Your extension'} is enabled.`
      : userExtensionStatus === 'disabled'
      ? `${userExtensionName || 'Your extension'} is disabled in chrome://extensions.`
      : userExtensionStatus === 'missing'
      ? 'No unpacked user extension was detected for this browser profile.'
      : userExtensionStatus === 'checking'
      ? 'Checking extension enabled status...'
      : 'Could not read extension status from background.'

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
        <DialogPrimitive.Portal container={portalContainer}>
          <DialogContent className="pointer-events-auto fixed left-1/2 top-1/2 z-[2147483647] grid w-[calc(100vw-32px)] max-w-[720px] -translate-x-1/2 -translate-y-1/2 gap-4 border border-neutral-700 bg-neutral-900 p-6 text-neutral-100 shadow-[0_20px_48px_rgba(0,0,0,0.5)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg">
            <div>
              <h3 className="text-lg font-semibold leading-none tracking-tight text-red-400">
                Extension.js diagnostics
              </h3>
              <p className="text-sm text-neutral-300">
                Setup checks + latest logs from page and content contexts.
              </p>
            </div>
            <div className="space-y-2 rounded border border-neutral-800 bg-neutral-950 p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-neutral-300">
                  Local network access (this site)
                </span>
                <span
                  className={
                    localNetworkStatus === 'granted'
                      ? 'text-emerald-400'
                      : localNetworkStatus === 'checking'
                      ? 'text-neutral-400'
                      : 'text-amber-400'
                  }
                >
                  {localNetworkStatus}
                </span>
              </div>
              <p className="text-xs text-neutral-400">{localNetworkDescription}</p>

              <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span className="text-neutral-300">User extension enabled</span>
                <span
                  className={
                    userExtensionStatus === 'enabled'
                      ? 'text-emerald-400'
                      : userExtensionStatus === 'checking'
                      ? 'text-neutral-400'
                      : 'text-amber-400'
                  }
                >
                  {userExtensionStatus}
                </span>
              </div>
              <p className="text-xs text-neutral-400">{userExtensionDescription}</p>
            </div>
            <div className="mt-2">
              <div className="h-[320px] w-full rounded border border-neutral-800 overflow-auto p-1">
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
              </div>
            </div>
          </DialogContent>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="pointer-events-none fixed left-4 bottom-4 z-[2147483647]">
        <Button
          onClick={() => setOpen(true)}
          className="pointer-events-auto relative rounded-full bg-neutral-900 border border-neutral-700 text-neutral-300 shadow hover:bg-neutral-800"
          size="icon"
          variant="secondary"
          aria-label={
            diagnosticsIssueCount > 0
              ? diagnosticsIssueLabel
              : errorCount > 0
              ? `Show errors (${errorCount})`
              : 'Show diagnostics'
          }
          title={
            diagnosticsIssueCount > 0
              ? diagnosticsIssueLabel
              : errorCount > 0
              ? `Show errors (${errorCount})`
              : 'Show diagnostics'
          }
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={
              diagnosticsIssueCount > 0 || errorCount > 0
                ? 'text-red-500'
                : 'text-neutral-400'
            }
          >
            <path
              fill="currentColor"
              d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Zm1 14h-2v-2h2v2Zm0-4h-2V6h2v6Z"
            />
          </svg>
          {diagnosticsIssueCount > 0 || errorCount > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] leading-5 text-center">
              {diagnosticsIssueCount + errorCount > 99
                ? '99+'
                : diagnosticsIssueCount + errorCount}
            </span>
          ) : null}
        </Button>
      </div>
    </>
  )
}
