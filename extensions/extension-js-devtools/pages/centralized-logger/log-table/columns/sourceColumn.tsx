import React from 'react'
import type {ColumnDef} from '@tanstack/react-table'
import {CopyButton} from '@/components/ui/copy-button'
import type {LogEvent} from '@/types/logger'

export function sourceColumn(): ColumnDef<LogEvent> {
  return {
    id: 'source',
    accessorFn: (row) => row.url || '',
    header: () => 'Source',
    cell: ({row}) => {
      const event = row.original
      const raw = event.url || ''

      return (
        <div className="flex items-center gap-1.5">
          <span
            title={raw}
            aria-label={raw}
            className="text-neutral-400 whitespace-nowrap overflow-hidden text-ellipsis"
          >
            {raw}
          </span>
          {raw ? (
            <CopyButton
              text={raw}
              idKey={`src:${event.id}`}
              ariaLabel="Copy source"
            />
          ) : null}
        </div>
      )
    },
    enableSorting: false
  }
}
