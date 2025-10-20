import React from 'react'
import type {ColumnDef} from '@tanstack/react-table'
import {getContextColorClass} from '@/lib/logger'
import type {LogEvent} from '@/types/logger'

export function contextColumn(): ColumnDef<LogEvent> {
  return {
    id: 'context',
    accessorFn: (row) => row.context,
    header: () => 'Context',
    cell: ({row, table}) => {
      const event = row.original
      const contextColorClass = getContextColorClass(event.context)
      const title = `${event.context}${typeof event.tabId === 'number' ? ` · tab#${event.tabId}` : ''}${typeof event.frameId === 'number' ? ` · frame#${event.frameId}` : ''}${event.incognito ? ' · incognito' : ''}`
      const onFilter = () => {
        try {
          ;(table as any)
            ?.getColumn?.('context')
            ?.setFilterValue?.(event.context)
        } catch {}
      }
      return (
        <button
          type="button"
          onClick={onFilter}
          className={`opacity-90 whitespace-nowrap ${contextColorClass}`}
          title={title}
        >
          [{event.context}]
          {event.incognito ? <span className="ml-1 opacity-75">🔒</span> : null}
        </button>
      )
    },
    enableSorting: false
  }
}
