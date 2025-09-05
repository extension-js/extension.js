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
      // Color mapping aligned with CLI
      const colorByLevel: Record<LogLevel, string> = {
        error: 'text-red-400',
        warn: 'text-yellow-300',
        info: 'text-sky-300',
        debug: 'text-violet-400',
        trace: 'text-white',
        log: 'text-neutral-300'
      }
      const colorClass = colorByLevel[e.level]
      return (
        <span className="inline-flex items-center gap-1.5 ml-0.5">
          {renderLevelDot(e.level, colorClass)}
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

function renderLevelDot(level: LogLevel, colorClass: string) {
  if (level === 'trace') {
    return (
      <span
        aria-hidden
        className="inline-block w-2 h-2 rounded-full border border-neutral-400"
        style={{backgroundColor: 'transparent'}}
      />
    )
  }
  const bgClass = colorClass.replace('text-', 'bg-')
  return (
    <span
      aria-hidden
      className={`inline-block w-2 h-2 rounded-full ${bgClass}`}
    />
  )
}
