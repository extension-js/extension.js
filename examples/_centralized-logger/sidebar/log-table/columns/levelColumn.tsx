import React from 'react'
import type {ColumnDef} from '@tanstack/react-table'
import type {LogEvent, LogLevel} from '@/types/logger'

export function levelColumn(): ColumnDef<LogEvent> {
  return {
    id: 'level',
    accessorFn: (row) => row.level,
    header: () => 'Level',
    cell: ({row}) => {
      const e = row.original
      // Color mapping aligned with CLI:
      // - log: gray, info: blue (sky), warn: yellow, debug: magenta (violet), trace: white (rendered hollow), error: red
      const colorClass =
        e.level === 'error'
          ? 'text-red-400'
          : e.level === 'warn'
            ? 'text-yellow-300'
            : e.level === 'info'
              ? 'text-sky-300'
              : e.level === 'debug'
                ? 'text-violet-400'
                : e.level === 'trace'
                  ? 'text-white'
                  : 'text-neutral-300'
      return (
        <span className="inline-flex items-center gap-1.5 ml-0.5">
          {e.level === 'trace' ? (
            // Trace: hollow circle with border color matching "log" (gray)
            <span
              aria-hidden
              className="inline-block w-2 h-2 rounded-full border border-neutral-400"
              style={{backgroundColor: 'transparent'}}
            />
          ) : (
            <span
              aria-hidden
              className={`inline-block w-2 h-2 rounded-full ${colorClass.replace('text-', 'bg-')}`}
            />
          )}
          <span className={colorClass}>{e.level}</span>
        </span>
      )
    },
    sortingFn: (a, b) => {
      const order: Record<LogLevel, number> = {
        error: 0,
        warn: 1,
        info: 2,
        log: 3,
        debug: 4,
        trace: 5
      }
      const av = (a.getValue('level') as LogLevel) || 'log'
      const bv = (b.getValue('level') as LogLevel) || 'log'
      return (order[av] ?? 3) - (order[bv] ?? 3)
    },
    enableSorting: false
  }
}
