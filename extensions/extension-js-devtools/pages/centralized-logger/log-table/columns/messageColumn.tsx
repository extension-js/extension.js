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

      return (
        <div
          className="flex items-center gap-1.5 text-neutral-400"
          data-testid="log-message"
        >
          <span
            className="whitespace-nowrap overflow-hidden text-ellipsis"
            title={formatMessageParts(event.messageParts)}
          >
            {highlightQuery(
              formatMessageParts(event.messageParts),
              searchQuery
            )}{' '}
            {event.url ? `(${highlightQuery(event.url, searchQuery)})` : ''}
          </span>
          <CopyButton
            text={formatMessageParts(event.messageParts)}
            idKey={`msg:${event.id}`}
            ariaLabel="Copy message"
          />
        </div>
      )
    },
    enableSorting: false
  }
}
