import React from 'react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from './tooltip'
import {Copy as CopyIcon, Check as CheckIcon} from 'lucide-react'

export type CopyButtonProps = {
  text: string
  idKey?: string
  ariaLabel?: string
  className?: string
  onCopied?: () => void
  onError?: (err: unknown) => void
}

export function CopyButton({
  text,
  idKey,
  ariaLabel = 'Copy',
  className,
  onCopied,
  onError
}: CopyButtonProps) {
  const recentlyCopied = React.useRef<Map<string, number> | null>(null)
  if (!recentlyCopied.current) recentlyCopied.current = new Map()
  const [copied, setCopied] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const copyText = async () => {
    try {
      // Prefer DOM-based copy methods first to avoid Permissions Policy violations
      let success = false
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        ta.style.pointerEvents = 'none'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        success = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {}
      if (!success) {
        try {
          const span = document.createElement('span')
          span.textContent = text
          span.style.whiteSpace = 'pre'
          span.style.position = 'fixed'
          span.style.opacity = '0'
          document.body.appendChild(span)
          const selection = window.getSelection?.()
          const range = document.createRange()
          range.selectNodeContents(span)
          selection?.removeAllRanges()
          selection?.addRange(range)
          success = document.execCommand('copy')
          selection?.removeAllRanges()
          document.body.removeChild(span)
        } catch {}
      }
      if (!success) {
        // As a last resort (and only in extension/secure pages), try async clipboard
        if (
          typeof navigator !== 'undefined' &&
          (location.protocol === 'chrome-extension:' ||
            location.protocol === 'https:') &&
          navigator.clipboard?.writeText
        ) {
          await navigator.clipboard.writeText(text)
          success = true
        }
      }
      if (!success) throw new Error('Copy not supported')
      if (idKey) {
        recentlyCopied.current!.set(idKey, Date.now())
      }
      setCopied(true)
      onCopied?.()
      setTimeout(() => setCopied(false), 1200)
    } catch (err) {
      onError?.(err)
    }
  }
  const displayCopied = React.useMemo(() => {
    if (copied) return true
    if (!idKey) return false
    const ts = recentlyCopied.current!.get(idKey)
    return typeof ts === 'number' && Date.now() - ts < 1200
  }, [copied, idKey])
  return (
    <TooltipProvider>
      <Tooltip open={open || copied} onOpenChange={setOpen}>
        <TooltipTrigger>
          <button
            aria-label={ariaLabel}
            type="button"
            className={
              className ||
              'copy-btn opacity-60 hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground'
            }
            onClick={copyText}
          >
            {displayCopied ? (
              <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <CopyIcon className="h-3.5 w-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          {/* {displayCopied ? 'Copied' : 'Copy'} */}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
