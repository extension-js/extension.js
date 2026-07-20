// ██████╗ ███████╗██╗   ██╗████████╗ ██████╗  ██████╗ ██╗     ███████╗
// ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
// ██║  ██║█████╗  ██║   ██║   ██║   ██║   ██║██║   ██║██║     ███████╗
// ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██║   ██║██║   ██║██║     ╚════██║
// ██████╔╝███████╗ ╚████╔╝    ██║   ╚██████╔╝╚██████╔╝███████╗███████║
// ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import React from 'react'
import type {ColumnDef} from '@tanstack/react-table'
import type {LogEvent} from '@/types/logger'

export function timeColumn(): ColumnDef<LogEvent> {
  return {
    id: 'time',
    accessorFn: (row) => row.timestamp,
    header: () => 'Time',
    cell: ({row}) => (
      <span className="opacity-70 whitespace-nowrap text-xs">
        {new Date(row.original.timestamp).toLocaleTimeString()}
      </span>
    ),
    enableSorting: true
  }
}
