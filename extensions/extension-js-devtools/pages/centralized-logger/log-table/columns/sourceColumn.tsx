import React from 'react'
import type {ColumnDef} from '@tanstack/react-table'
import {CopyButton} from '@/components/ui/copy-button'
import type {LogEvent} from '@/types/logger'

export function sourceColumn(): ColumnDef<LogEvent> {
  const normalize = (row: LogEvent): {label: string; raw: string} => {
    const raw = row.url || ''
    // Streamlined rule: always display the URL as the label (including chrome://, about:*, moz/chrome-extension://)
    return {label: raw, raw}
  }
  return {
    id: 'source',
    accessorFn: (row) => row.url || '',
    header: () => 'Source',
    cell: ({row}) => {
      const event = row.original
      const {label, raw} = normalize(event)

      return (
        <div className="flex items-center gap-1.5">
          <span
            title={raw}
            aria-label={raw}
            className="text-neutral-400 whitespace-nowrap overflow-hidden text-ellipsis"
          >
            {label}
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
