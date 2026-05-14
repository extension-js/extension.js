import {useEffect, useMemo, useRef, useState} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {Button} from '@/components/ui/button'
import {ScrollArea} from '@/components/ui/scroll-area'
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs'
import logo from '@/images/logo.png'
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

type UserExtensionStatus =
  | 'checking'
  | 'enabled'
  | 'disabled'
  | 'missing'
  | 'error'

const DialogOverlay = DialogPrimitive.Overlay as any
const DialogContent = DialogPrimitive.Content as any

type DxSignalPayload = {
  code: string
  status: 'ok' | 'warn' | 'fail'
  level: LogLevel
  messageParts: unknown[]
  remediation?: string
  data?: Record<string, unknown>
}

export default function ContentApp({portalContainer}: ContentAppProps) {
  const isErrorOverlayEnabled =
    String((import.meta as any).env?.EXTENSION_PUBLIC_ERROR_OVERLAY || '')
      .trim()
      .toLowerCase() === 'true'
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [userExtensionStatus, setUserExtensionStatus] =
    useState<UserExtensionStatus>('checking')
  const [userExtensionName, setUserExtensionName] = useState<string>('')
  const [errorTab, setErrorTab] = useState<'all' | 'page' | 'content'>('all')
  const [copyTabState, setCopyTabState] = useState<'idle' | 'copied' | 'failed'>(
    'idle'
  )
  const [isReloading, setIsReloading] = useState(false)
  const idRef = useRef(1)
  const autoOpenedRef = useRef(false)
  const lastExtensionSignalRef = useRef<string>('')
  const reloadDoneTimerRef = useRef<number | undefined>(undefined)

  const errorCount = entries.filter((e) => e.level === 'error').length
  const pageErrors = useMemo(
    () => entries.filter((e) => e.context === 'page' && e.level === 'error'),
    [entries]
  )
  const contentErrors = useMemo(
    () => entries.filter((e) => e.context === 'content' && e.level === 'error'),
    [entries]
  )
  const allErrors = useMemo(
    () => entries.filter((e) => e.level === 'error'),
    [entries]
  )
  const diagnosticsIssueCount = userExtensionStatus !== 'enabled' ? 1 : 0

  const addEntry = (
    level: LogLevel,
    context: LoggerContext,
    parts: unknown[],
    url?: string
  ) => {
    if (!isErrorOverlayEnabled) return
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
    if (!isErrorOverlayEnabled) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data

      if (!data || !data.__reactLogger || data.type !== 'log' || !data.level) {
        return
      }

      addEntry(data.level, data.context || 'page', data.messageParts, data.url)
    }

    window.addEventListener('message', onMessage)

    const isExtensionOrigin = (url: string) =>
      url.startsWith('chrome-extension://') ||
      url.startsWith('moz-extension://') ||
      url.startsWith('safari-web-extension://')

    const stackHasExtensionOrigin = (stack: string) =>
      /\b(?:chrome|moz|safari-web)-extension:\/\//.test(stack)

    const classifyErrorEvent = (event: ErrorEvent): LoggerContext => {
      const filename = String(event.filename || '')
      const stack = String(
        (event.error as Error | undefined)?.stack || ''
      )

      if (
        (filename && isExtensionOrigin(filename)) ||
        (stack && stackHasExtensionOrigin(stack))
      ) {
        return 'content'
      }
      return 'page'
    }

    const classifyRejection = (
      event: PromiseRejectionEvent
    ): LoggerContext => {
      const reason = event.reason as unknown
      const stack =
        reason instanceof Error ? String(reason.stack || '') : ''
      return stack && stackHasExtensionOrigin(stack) ? 'content' : 'page'
    }

    const onError = (event: ErrorEvent) => {
      addEntry(
        'error',
        classifyErrorEvent(event),
        [event.message],
        event.filename || location.href
      )
    }

    const onRejection = (event: PromiseRejectionEvent) => {
      addEntry(
        'error',
        classifyRejection(event),
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
  }, [isErrorOverlayEnabled])

  useEffect(() => {
    if (!isErrorOverlayEnabled) return
    const onMessage = (message: unknown) => {
      const payload = message as
        | {type?: string; state?: 'reloading' | 'reloaded'}
        | undefined
      if (!payload || payload.type !== 'extjs-dev-reload') return

      if (payload.state === 'reloading') {
        if (reloadDoneTimerRef.current !== undefined) {
          window.clearTimeout(reloadDoneTimerRef.current)
          reloadDoneTimerRef.current = undefined
        }
        setIsReloading(true)
      } else if (payload.state === 'reloaded') {
        if (reloadDoneTimerRef.current !== undefined) {
          window.clearTimeout(reloadDoneTimerRef.current)
        }
        // Briefly keep the indicator visible so the transition is perceivable
        // even when the disabled→enabled flip is near-instant.
        setIsReloading(true)
        reloadDoneTimerRef.current = window.setTimeout(() => {
          setIsReloading(false)
          reloadDoneTimerRef.current = undefined
        }, 900)
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
      if (reloadDoneTimerRef.current !== undefined) {
        window.clearTimeout(reloadDoneTimerRef.current)
      }
    }
  }, [isErrorOverlayEnabled])

  const diagnosticsIssueLabel =
    diagnosticsIssueCount === 1
      ? '1 setup check needs attention'
      : `${diagnosticsIssueCount} setup checks need attention`

  const emitDxSignal = (payload: DxSignalPayload) => {
    if (!isErrorOverlayEnabled) return
    try {
      chrome.runtime.sendMessage({
        type: 'dx-signal',
        eventType: 'dx.signal',
        context: 'content',
        level: payload.level,
        code: payload.code,
        status: payload.status,
        messageParts: payload.messageParts,
        remediation: payload.remediation,
        data: payload.data,
        url: location.href
      })
    } catch {}
  }

  useEffect(() => {
    if (!isErrorOverlayEnabled) return
    let mounted = true

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

    refreshUserExtensionStatus()

    const onFocus = () => {
      refreshUserExtensionStatus()
    }

    window.addEventListener('focus', onFocus)
    const intervalId = window.setInterval(onFocus, 7000)

    return () => {
      mounted = false
      window.removeEventListener('focus', onFocus)
      window.clearInterval(intervalId)
    }
  }, [isErrorOverlayEnabled])

  useEffect(() => {
    if (!isErrorOverlayEnabled) return
    if (autoOpenedRef.current) return
    if (userExtensionStatus === 'checking') return
    if (userExtensionStatus === 'enabled') return

    setOpen(true)
    autoOpenedRef.current = true
  }, [isErrorOverlayEnabled, userExtensionStatus])

  const userExtensionDescription =
    userExtensionStatus === 'enabled'
      ? `${userExtensionName || 'Your extension'} is enabled.`
      : userExtensionStatus === 'disabled'
      ? `${userExtensionName || 'Your extension'} is disabled in chrome://extensions.`
      : userExtensionStatus === 'missing'
      ? 'No unpacked user extension was detected for this browser profile.'
      : userExtensionStatus === 'checking'
      ? 'Checking extension enabled status...'
      : 'Could not read extension status.'

  const compactErrorMessage = (message: string) => {
    const text = String(message || '').replace(/\s+/g, ' ').trim()
    if (!text) return 'Unknown error'
    if (text.startsWith('unhandledrejection ')) {
      return `Unhandled promise rejection: ${text.replace(
        /^unhandledrejection\s+/,
        ''
      )}`
    }
    return text.length > 180 ? `${text.slice(0, 180)}...` : text
  }

  const tabErrors =
    errorTab === 'all'
      ? allErrors
      : errorTab === 'page'
      ? pageErrors
      : contentErrors

  const compactSource = (entry: LogEntry) => {
    const url = String(entry.url || '')
    if (!url) return entry.context
    try {
      const parsed = new URL(url)
      return `${entry.context} • ${parsed.host}${parsed.pathname}`
    } catch {
      return `${entry.context} • ${url}`
    }
  }

  const copyCurrentTabView = async () => {
    if (!isErrorOverlayEnabled) return
    const payload = {
      source: 'extension.js',
      view: 'content-diagnostics-error-tab',
      selectedTab: errorTab,
      timestamp: new Date().toISOString(),
      pageUrl: location.href,
      setup: {
        userExtensionStatus,
        userExtensionName: userExtensionName || null
      },
      counts: {
        all: allErrors.length,
        page: pageErrors.length,
        content: contentErrors.length
      },
      items: tabErrors.slice(-30).map((entry) => ({
        id: entry.id,
        level: entry.level,
        context: entry.context,
        message: compactErrorMessage(entry.message),
        source: compactSource(entry),
        time: entry.time
      }))
    }
    const text = JSON.stringify(payload, null, 2)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', 'true')
        area.style.position = 'fixed'
        area.style.left = '-9999px'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      }
      setCopyTabState('copied')
      window.setTimeout(() => setCopyTabState('idle'), 1200)
    } catch {
      setCopyTabState('failed')
      window.setTimeout(() => setCopyTabState('idle'), 1500)
    }
  }

  useEffect(() => {
    if (!isErrorOverlayEnabled) return
    if (userExtensionStatus === 'checking') return
    const key = `${userExtensionStatus}:${userExtensionName}:${location.href}`
    if (lastExtensionSignalRef.current === key) return
    lastExtensionSignalRef.current = key

    if (userExtensionStatus === 'enabled') {
      emitDxSignal({
        code: 'DX_EXTENSION_ENABLED',
        status: 'ok',
        level: 'info',
        messageParts: [`${userExtensionName || 'User extension'} is enabled.`],
        data: {
          extensionEnabled: true,
          extensionName: userExtensionName || undefined
        }
      })
      return
    }

    if (userExtensionStatus === 'disabled') {
      emitDxSignal({
        code: 'DX_EXTENSION_DISABLED',
        status: 'fail',
        level: 'error',
        messageParts: [
          `${userExtensionName || 'User extension'} is disabled in extensions page.`
        ],
        remediation: 'Enable your unpacked extension in chrome://extensions.',
        data: {
          extensionEnabled: false,
          extensionName: userExtensionName || undefined
        }
      })
      return
    }

    if (userExtensionStatus === 'missing') {
      emitDxSignal({
        code: 'DX_EXTENSION_MISSING',
        status: 'warn',
        level: 'warn',
        messageParts: ['No unpacked user extension was detected.'],
        remediation: 'Load your extension unpacked in this browser profile.',
        data: {extensionEnabled: null}
      })
      return
    }

    emitDxSignal({
      code: 'DX_EXTENSION_STATUS_ERROR',
      status: 'warn',
      level: 'warn',
      messageParts: ['Failed to read user extension status from background.'],
      remediation: 'Reload Extension.js devtools and check browser extension state.',
      data: {extensionEnabled: null}
    })
  }, [isErrorOverlayEnabled, userExtensionStatus, userExtensionName])

  if (!isErrorOverlayEnabled) {
    return null
  }

  // Hardcoded surface colors. Tailwind v4 routes `bg-neutral-900` through the
  // CSS variable `--color-neutral-900`, and CSS variables inherit through open
  // shadow roots — so a host page that overrides that variable (or one of the
  // shadcn `--background`/`--card`/etc. tokens this project also defines) can
  // bleed transparency or any other color into our overlay. `bg-opacity-100`
  // is a no-op in Tailwind v4 (it generates zero rules), so the safety net I
  // added earlier was illusory. Inline-styling the dialog/card/launcher
  // surfaces with concrete RGB removes every layer of indirection and makes
  // the overlay opaque regardless of host-page CSS or Tailwind version.
  const SURFACE_DIALOG = '#0a0a0a' // neutral-950 equivalent, fully opaque
  const SURFACE_CARD = '#171717' // neutral-900 equivalent
  const SURFACE_LAUNCHER = '#0a0a0a'
  const BORDER_NEUTRAL = '#404040' // neutral-700 equivalent
  const BORDER_CARD = '#262626' // neutral-800 equivalent

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
        <DialogPrimitive.Portal container={portalContainer}>
          <DialogContent
            // Radix scans the *direct* children of `Content` for a `Title` and
            // emits an a11y warning when none is found. The Title used to live
            // inside a wrapping `<div>`, which tripped that check on every
            // open — render it as a direct child instead.
            style={{
              backgroundColor: SURFACE_DIALOG,
              borderColor: BORDER_NEUTRAL,
              color: '#f5f5f5',
              opacity: 1
            }}
            // Row template: Title, Description, diagnostics card (intrinsic
            // height — just what the User-extension box needs), then the error
            // tabs section taking the remaining 1fr.
            className="pointer-events-auto fixed left-1/2 top-1/2 z-[2147483647] grid grid-rows-[auto_auto_auto_1fr] h-[min(640px,calc(100vh-32px))] w-[calc(100vw-32px)] max-w-[760px] overflow-hidden -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border p-6 shadow-[0_20px_48px_rgba(0,0,0,0.6)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-bottom-[52%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-bottom-[52%]"
          >
            <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight text-red-400">
              Extension.js diagnostics
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-neutral-300">
              Setup health + split errors from page and content script contexts.
            </DialogPrimitive.Description>
            <div className="grid grid-cols-1 gap-3">
              <div
                style={{backgroundColor: SURFACE_CARD, borderColor: BORDER_CARD}}
                className="space-y-2 rounded-xl border p-3"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
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
            </div>
            <div
              style={{backgroundColor: SURFACE_CARD, borderColor: BORDER_CARD}}
              className="flex min-h-0 flex-col rounded border p-3"
            >
              <Tabs
                value={errorTab}
                onValueChange={(v) => setErrorTab(v as 'all' | 'page' | 'content')}
                className="flex min-h-0 flex-1 flex-col"
              >
                {/* TabsList and the "Copy tab view" button share a single row
                    now that the section heading is gone, so the button no
                    longer overlaps the tab triggers. */}
                <div className="flex items-center justify-between gap-2">
                  <TabsList className="w-fit border border-neutral-800 bg-neutral-950">
                    <TabsTrigger value="all">All ({allErrors.length})</TabsTrigger>
                    <TabsTrigger value="page">Page ({pageErrors.length})</TabsTrigger>
                    <TabsTrigger value="content">
                      Content script ({contentErrors.length})
                    </TabsTrigger>
                  </TabsList>
                  <button
                    type="button"
                    onClick={copyCurrentTabView}
                    style={{
                      backgroundColor: SURFACE_DIALOG,
                      borderColor: BORDER_NEUTRAL
                    }}
                    className="shrink-0 rounded border px-2 py-1 text-[11px] text-neutral-300 hover:opacity-90"
                    title="Copy current tab diagnostics as JSON"
                  >
                    {copyTabState === 'copied'
                      ? 'Copied'
                      : copyTabState === 'failed'
                      ? 'Copy failed'
                      : 'Copy tab view'}
                  </button>
                </div>

                <TabsContent value="all" className="min-h-0 flex-1 data-[state=active]:flex">
                  <div className="h-full rounded border border-neutral-800 p-2">
                    <ScrollArea className="h-full">
                      <div className="space-y-2 pr-2">
                      {allErrors.length === 0 ? (
                        <div className="text-xs text-neutral-500">
                          No errors in this tab.
                        </div>
                      ) : (
                        allErrors.slice(-30).reverse().map((entry) => (
                          <div key={`tab-all-${entry.id}`} className="text-xs">
                            <p className="text-red-400 break-words">
                              {compactErrorMessage(entry.message)}
                            </p>
                            <p className="text-neutral-500">
                              {compactSource(entry)} •{' '}
                              {new Date(entry.time).toLocaleTimeString()}
                            </p>
                          </div>
                        ))
                      )}
                      </div>
                    </ScrollArea>
                  </div>
                </TabsContent>

                <TabsContent value="page" className="min-h-0 flex-1 data-[state=active]:flex">
                  <div className="h-full rounded border border-neutral-800 p-2">
                    <ScrollArea className="h-full">
                      <div className="space-y-2 pr-2">
                      {pageErrors.length === 0 ? (
                        <div className="text-xs text-neutral-500">
                          No errors in this tab.
                        </div>
                      ) : (
                        pageErrors.slice(-30).reverse().map((entry) => (
                          <div key={`tab-page-${entry.id}`} className="text-xs">
                            <p className="text-red-400 break-words">
                              {compactErrorMessage(entry.message)}
                            </p>
                            <p className="text-neutral-500">
                              {compactSource(entry)} •{' '}
                              {new Date(entry.time).toLocaleTimeString()}
                            </p>
                          </div>
                        ))
                      )}
                      </div>
                    </ScrollArea>
                  </div>
                </TabsContent>

                <TabsContent value="content" className="min-h-0 flex-1 data-[state=active]:flex">
                  <div className="h-full rounded border border-neutral-800 p-2">
                    <ScrollArea className="h-full">
                      <div className="space-y-2 pr-2">
                      {contentErrors.length === 0 ? (
                        <div className="text-xs text-neutral-500">
                          No errors in this tab.
                        </div>
                      ) : (
                        contentErrors.slice(-30).reverse().map((entry) => (
                          <div key={`tab-content-${entry.id}`} className="text-xs">
                            <p className="text-red-400 break-words">
                              {compactErrorMessage(entry.message)}
                            </p>
                            <p className="text-neutral-500">
                              {compactSource(entry)} •{' '}
                              {new Date(entry.time).toLocaleTimeString()}
                            </p>
                          </div>
                        ))
                      )}
                      </div>
                    </ScrollArea>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </DialogContent>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="pointer-events-none fixed left-4 bottom-4 z-[2147483647] flex items-center gap-2">
        <Button
          onClick={() => setOpen(true)}
          // `rounded-full` makes the launcher fully circular. The background
          // is forced via inline style (concrete RGB) so it stays solid
          // regardless of host-page CSS variable overrides; z-index lifted to
          // the max signed 32-bit value so the pill always wins over any
          // host-page stacking context.
          style={{
            backgroundColor: SURFACE_LAUNCHER,
            borderColor: BORDER_NEUTRAL,
            color: '#d4d4d4',
            opacity: 1
          }}
          className="pointer-events-auto relative rounded-full border shadow hover:opacity-90"
          size="icon"
          variant="secondary"
          aria-label={
            isReloading
              ? 'Extension is reloading'
              : diagnosticsIssueCount > 0
              ? diagnosticsIssueLabel
              : errorCount > 0
              ? `Show errors (${errorCount})`
              : 'Show diagnostics'
          }
          title={
            isReloading
              ? 'Extension is reloading'
              : diagnosticsIssueCount > 0
              ? diagnosticsIssueLabel
              : errorCount > 0
              ? `Show errors (${errorCount})`
              : 'Show diagnostics'
          }
        >
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className={
              'max-h-full max-w-full select-none ' +
              (diagnosticsIssueCount > 0 || errorCount > 0
                ? 'ring-1 ring-red-500/80'
                : '')
            }
          />
          {diagnosticsIssueCount > 0 || errorCount > 0 ? (
            <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] leading-5 text-center">
              {diagnosticsIssueCount + errorCount > 99
                ? '99+'
                : diagnosticsIssueCount + errorCount}
            </span>
          ) : null}
        </Button>
        {isReloading ? (
          <span
            role="status"
            aria-live="polite"
            style={{
              backgroundColor: SURFACE_LAUNCHER,
              borderColor: BORDER_NEUTRAL,
              color: '#e5e5e5',
              opacity: 1
            }}
            className="pointer-events-none rounded-full border px-3 py-1 text-xs font-medium shadow"
          >
            Reloading…
          </span>
        ) : null}
      </div>
    </>
  )
}
