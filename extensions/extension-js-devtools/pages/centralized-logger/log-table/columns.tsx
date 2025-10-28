import type {ColumnDef} from '@tanstack/react-table'

import {timeColumn} from './columns/timeColumn'
import {contextColumn} from './columns/contextColumn'
import {sourceColumn} from './columns/sourceColumn'
import {levelColumn} from './columns/levelColumn'
import {messageColumn} from './columns/messageColumn'
import {expandColumn} from './columns/expandColumn'

import type {LogEvent} from '@/types/logger'

export function createLogColumns(args: {
  searchQuery: string
  expanded: Set<string>
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>
  containerRef: React.MutableRefObject<HTMLDivElement | null>
}): ColumnDef<LogEvent>[] {
  const {searchQuery, expanded, setExpanded, containerRef} = args
  return [
    timeColumn(),
    levelColumn(),
    messageColumn(searchQuery),
    contextColumn(),
    sourceColumn(),
    expandColumn(expanded, setExpanded, containerRef)
  ]
}
