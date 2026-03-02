import React from 'react'
import type {ColumnDef} from '@tanstack/react-table'
import {CopyButton} from '@/components/ui/copy-button'
import {formatMessageParts} from '@/lib/logger'
import type {LogEvent} from '@/types/logger'

export function highlightQuery(
  text: string,
  queryText: string
): React.ReactNode {
  const query = queryText.trim()

  if (!query) return text

  const idx = text.toLowerCase().indexOf(query.toLowerCase())

  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export function messageColumn(searchQuery: string): ColumnDef<LogEvent> {
  return {
    id: 'message',
    accessorFn: (row) => formatMessageParts(row.messageParts || []),
    header: () => 'Message',
    cell: ({row}) => {
      const event = row.original
      const message = formatMessageParts(event.messageParts)
      const isDxSignal = event.eventType === 'dx.signal'

      return (
        <div className="flex items-center gap-1.5 text-neutral-400">
          {isDxSignal ? (
            <span className="inline-flex rounded border border-amber-700/50 bg-amber-950/40 px-1 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
              setup
            </span>
          ) : null}
          <span
            className="whitespace-nowrap overflow-hidden text-ellipsis"
            title={message}
          >
            {highlightQuery(message, searchQuery)}{' '}
            {event.url ? `(${highlightQuery(event.url, searchQuery)})` : ''}
          </span>
          <CopyButton
            text={message}
            idKey={`msg:${event.id}`}
            ariaLabel="Copy message"
          />
        </div>
      )
    },
    enableSorting: false
  }
}
