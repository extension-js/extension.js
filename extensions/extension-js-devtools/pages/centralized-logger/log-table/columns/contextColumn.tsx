import React from 'react'
import type {ColumnDef} from '@tanstack/react-table'
import {getContextColorClass} from '@/lib/logger'
import type {LogEvent} from '@/types/logger'

export function contextColumn(): ColumnDef<LogEvent> {
  return {
    id: 'context',
    accessorFn: (row) =>
      `${row.context}${typeof row.tabId === 'number' ? `#${row.tabId}` : ''}${typeof row.frameId === 'number' ? `:${row.frameId}` : ''}`,
    header: () => 'Context',
    cell: ({row}) => {
      const event = row.original
      const contextColorClass = getContextColorClass(event.context)
      return (
        <span
          className={`opacity-90 whitespace-nowrap ${contextColorClass}`}
          title={`${event.context}${typeof event.tabId === 'number' ? `#${event.tabId}` : ''}${typeof event.frameId === 'number' ? `:${event.frameId}` : ''}`}
        >
          [{event.context}
          {typeof event.tabId === 'number' ? `#${event.tabId}` : ''}
          {typeof event.frameId === 'number' ? `:${event.frameId}` : ''}]
        </span>
      )
    },
    enableSorting: false
  }
}
