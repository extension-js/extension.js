import React from 'react'
import {ChevronDown} from 'lucide-react'
import type {ColumnDef} from '@tanstack/react-table'
import {Button} from '@/components/ui/button'
import type {LogEvent} from '@/types/logger'

export function expandColumn(
  expanded: Set<string>,
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>,
  containerRef: React.MutableRefObject<HTMLDivElement | null>
): ColumnDef<LogEvent> {
  return {
    id: 'expand-action',
    header: () => null,
    cell: ({row}) => {
      const handleToggleExpand = () => {
        const id = row.original.id
        setExpanded((prev: Set<string>) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })

        requestAnimationFrame(() => {
          const container = containerRef.current
          if (!container) return

          const element = container.querySelector(
            `[data-row-id='${CSS.escape(String(id))}']`
          ) as HTMLElement | null

          if (!element) return

          const headerOffset = 24
          container.scrollTop = element.offsetTop - headerOffset
        })
      }
      return (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 bg-transparent"
            onClick={handleToggleExpand}
            data-testid="expand-button"
          >
            <span className="inline-flex items-center gap-1.5">
              {expanded.has(row.original.id) ? 'Hide' : 'More'}
              <ChevronDown className="h-3.5 w-3.5" />
            </span>
          </Button>
        </div>
      )
    },
    enableSorting: false
  }
}
