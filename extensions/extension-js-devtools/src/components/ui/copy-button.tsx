import * as React from 'react'
import {Copy} from 'lucide-react'

import {cn} from '../../lib/utils'
import {Button} from './button'

type CopyButtonProps = {
  text: string
  idKey?: string
  ariaLabel?: string
  className?: string
}

export function CopyButton({
  text,
  idKey,
  ariaLabel = 'Copy',
  className
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // ignore copy failures
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={ariaLabel}
      data-copy-id={idKey}
      onClick={handleCopy}
      className={cn('h-6 w-6', className)}
    >
      <Copy className="h-3 w-3" />
      <span className="sr-only">{copied ? 'Copied' : ariaLabel}</span>
    </Button>
  )
}
