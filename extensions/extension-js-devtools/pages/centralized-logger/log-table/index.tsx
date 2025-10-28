import React, {useState} from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  flexRender
} from '@tanstack/react-table'
import {Card, CardContent} from '@/components/ui/card'
import {Collapsible, CollapsibleContent} from '@/components/ui/collapsible'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell
} from '@/components/ui/table'
import type {LogEvent} from '@/types/logger'
import {useSortingPersistence} from '../hooks/useSortingPersistence'
import {useAutoScrollBatch} from '../hooks/useAutoScrollBatch'
import {createLogColumns} from './columns'
import {CopyButton} from '@/components/ui/copy-button'

export function LogTableView({
  events,
  autoScroll,
  searchQuery
}: {
  events: LogEvent[]
  autoScroll: boolean
  searchQuery: string
}) {
  const {
    containerRef,
    visibleItems: visibleEvents,
    handleScroll
  } = useAutoScrollBatch<LogEvent>(events, autoScroll)

  // Cap rows to keep table snappy under load
  const cappedEvents = React.useMemo(
    () => visibleEvents.slice(-3000),
    [visibleEvents]
  )
  const {sorting, setTimeOnlySorting} = useSortingPersistence()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const columns = React.useMemo<ColumnDef<LogEvent>[]>(
    () =>
      createLogColumns({
        searchQuery,
        expanded,
        setExpanded,
        containerRef
      }),
    [searchQuery, expanded]
  )

  const table = useReactTable({
    data: cappedEvents,
    columns,
    state: {sorting},
    onSortingChange: setTimeOnlySorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  })

  const renderExpandedDetails = (event: LogEvent) => {
    const json = JSON.stringify(
      {
        timestamp: event.timestamp,
        level: event.level,
        context: event.context,
        tabId: event.tabId,
        frameId: event.frameId,
        url: event.url,
        messageParts: event.messageParts,
        stack: event.stack
      },
      null,
      2
    )
    const lines = json.split('\n').length
    const height = Math.max(120, Math.min(360, lines * 18 + 24))
    const heightClass =
      height <= 160
        ? 'max-h-[120px]'
        : height <= 300
          ? 'max-h-[240px]'
          : 'max-h-[360px]'
    return (
      <div className="relative">
        <CopyButton
          text={json}
          idKey={`more:${event.id}`}
          ariaLabel="Copy details"
          className="copy-btn absolute top-[6px] right-[6px] z-[1]"
        />
        <pre
          className={`whitespace-pre-wrap m-0 overflow-auto p-2 text-[0.75rem] ${heightClass}`}
        >
          {json}
        </pre>
      </div>
    )
  }

  return (
    <Card className="w-full h-full">
      <CardContent className="p-0 h-full">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="min-h-[120px] h-[calc(100vh-65px-16px-16px)] overflow-auto"
        >
          <Table className="h-full table-fixed w-full border-collapse border-b border-border">
            <TableHeader className="">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow className="h-7" key={headerGroup.id}>
                  {headerGroup.headers
                    .filter((header) => !header.isPlaceholder)
                    .map((header, idx, arr) => (
                      <TableHead
                        key={header.id}
                        className={
                          `group h-7 select-none relative sticky top-0 z-[1] bg-background border-b border-border py-[2px] ` +
                          `${header.column.getCanSort() ? 'cursor-pointer' : ''} ` +
                          `${header.column.id === 'time' ? 'w-[9ch] min-w-[9ch]' : ''} ` +
                          `${header.column.id === 'context' ? 'w-[20ch] min-w-[20ch]' : ''} ` +
                          `${header.column.id === 'source' ? 'w-[20ch] min-w-[20ch]' : ''} ` +
                          `${header.column.id === 'level' ? 'w-[7ch] min-w-[7ch]' : ''} ` +
                          `${header.column.id === 'expand-action' ? 'w-[9ch] min-w-[9ch] hidden sm:table-cell' : ''} ` +
                          `${header.column.id === 'expand-action' ? 'text-right' : 'text-left'} ` +
                          `${idx === 0 ? 'rounded-tl-lg' : ''} ` +
                          `${idx === arr.length - 1 ? 'rounded-tr-lg' : ''}`
                        }
                        onClick={
                          header.column.getCanSort()
                            ? header.column.getToggleSortingHandler()
                            : undefined
                        }
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                      </TableHead>
                    ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <React.Fragment key={row.id}>
                  <TableRow
                    data-row-id={row.original.id}
                    className={
                      Number(row.id.split(':').pop() || 0) % 2 === 1
                        ? 'border-b border-border bg-background'
                        : 'border-b border-border'
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={
                          `py-[3px] px-[6px] whitespace-nowrap overflow-hidden text-ellipsis ${cell.column.id === 'expand-action' ? 'text-right' : 'text-left'} ` +
                          `${cell.column.id === 'time' ? 'w-[9ch] min-w-[9ch]' : ''} ` +
                          `${cell.column.id === 'context' ? 'w-[20ch] min-w-[20ch]' : ''} ` +
                          `${cell.column.id === 'source' ? 'w-[20ch] min-w-[20ch]' : ''} ` +
                          `${cell.column.id === 'level' ? 'w-[7ch] min-w-[7ch]' : ''} ` +
                          `${cell.column.id === 'expand-action' ? 'w-[9ch] min-w-[9ch] hidden sm:table-cell' : ''}`
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                  {/* expanded content row */}
                  <TableRow className="border-b-0">
                    <TableCell
                      className="border-b-0"
                      colSpan={table.getVisibleLeafColumns().length}
                    >
                      <Collapsible
                        open={expanded.has(row.original.id)}
                        onOpenChange={((rowId: string) => (open: boolean) => {
                          setExpanded((prev: Set<string>) => {
                            const next = new Set(prev)
                            if (open) next.add(rowId)
                            else next.delete(rowId)
                            return next
                          })
                        })(row.original.id)}
                      >
                        <CollapsibleContent>
                          {renderExpandedDetails(row.original)}
                        </CollapsibleContent>
                      </Collapsible>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
          {table.getRowModel().rows.length === 0 ? (
            <div className="p-2">No logs yet.</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
