import React from 'react'
import {Label} from '@/components/ui/label'
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue
} from '@/components/ui/select'
import type {LoggerContext, LogLevel} from '@/types/logger'

export type FiltersRowProps = {
  contextFilter: LoggerContext | 'all'
  setContextFilter: (value: LoggerContext | 'all') => void
  tabFilter: number | 'all'
  setTabFilter: (value: number | 'all') => void
  levelFilter: LogLevel | 'all'
  setLevelFilter: (value: LogLevel | 'all') => void
  uniqueTabs: number[]
  tabMeta?: Record<number, {url?: string}>
  getContextColorClass?: (ctx: LoggerContext) => string
}

// Unified color class mapping for log levels
const LOG_LEVEL_COLOR_CLASS: Record<LogLevel, string> = {
  error: 'bg-red-400',
  warn: 'bg-yellow-300',
  info: 'bg-sky-300',
  debug: 'bg-violet-400',
  trace: 'bg-neutral-400',
  log: 'bg-neutral-300'
}

export function FiltersRow({
  contextFilter,
  setContextFilter,
  tabFilter,
  setTabFilter,
  levelFilter,
  setLevelFilter,
  uniqueTabs,
  tabMeta,
  getContextColorClass
}: FiltersRowProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Label htmlFor="ctx" className="text-xs">
        Context:
      </Label>
      <Select
        value={contextFilter}
        onValueChange={(value) =>
          setContextFilter(value as LoggerContext | 'all')
        }
        data-testid="context-filter"
      >
        <SelectTrigger id="ctx" className="h-9 px-3 text-sm w-[140px]">
          <SelectValue placeholder="Context" />
        </SelectTrigger>
        <SelectContent className="p-0 text-xs">
          <SelectItem className="text-xs" value="all">
            All
          </SelectItem>
          {(
            [
              'background',
              'content',
              'page',
              'sidebar',
              'popup',
              'options',
              'devtools'
            ] as const
          ).map((ctx) => (
            <SelectItem key={ctx} className="text-xs" value={ctx}>
              <span className={getContextColorClass?.(ctx)}>[{ctx}]</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Label htmlFor="tab" className="text-xs">
        Tab:
      </Label>
      <Select
        value={tabFilter === 'all' ? 'all' : String(tabFilter)}
        onValueChange={(v) => setTabFilter(v === 'all' ? 'all' : Number(v))}
        data-testid="tab-filter"
      >
        <SelectTrigger id="tab" className="h-9 px-3 text-sm w-[180px]">
          {tabFilter === 'all' ? 'All' : `Tab #${tabFilter}`}
        </SelectTrigger>
        <SelectContent className="p-0 text-xs w-auto max-w-[75vw]">
          <SelectItem className="text-xs" value="all">
            All
          </SelectItem>
          {uniqueTabs.map((t) => {
            const url = tabMeta?.[t]?.url || ''
            let host = url
            try {
              host = url ? new URL(url).host : ''
            } catch {}
            return (
              <SelectItem className="text-xs" key={t} value={String(t)}>
                <span
                  className="flex flex-col w-full max-w-full"
                  title={url || `Tab #${t}`}
                >
                  <span className="text-foreground font-medium truncate">
                    {host || `Tab #${t}`}
                  </span>
                  <span className="opacity-60 truncate">
                    Tab #{t}
                    {url ? ` • ${url}` : ''}
                  </span>
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      <Label htmlFor="level" className="text-xs">
        Level:
      </Label>
      <Select
        value={levelFilter}
        onValueChange={(value) => setLevelFilter(value as LogLevel | 'all')}
        data-testid="level-filter"
      >
        <SelectTrigger id="level" className="h-9 px-3 text-sm w-[110px]">
          <SelectValue placeholder="Level" />
        </SelectTrigger>
        <SelectContent className="p-0 text-xs">
          <SelectItem className="text-xs" value="all">
            All
          </SelectItem>
          {(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map(
            (lvl) => (
              <SelectItem key={lvl} className="text-xs" value={lvl}>
                <span className="inline-flex items-center gap-1.5 w-full">
                  <span
                    aria-hidden
                    className={
                      'inline-block w-2 h-2 rounded-full ' +
                      (LOG_LEVEL_COLOR_CLASS[lvl] || 'bg-neutral-300')
                    }
                  />
                  <span>{lvl}</span>
                </span>
              </SelectItem>
            )
          )}
        </SelectContent>
      </Select>

      <ToggleGroup
        type="single"
        value={levelFilter === 'all' ? '' : levelFilter}
        onValueChange={(value) => setLevelFilter((value as LogLevel) || 'all')}
        className="max-[1024px]:hidden"
      >
        {(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map(
          (lvl) => (
            <ToggleGroupItem
              key={lvl}
              value={lvl}
              aria-label={`toggle ${lvl}`}
              className="text-sm h-9 px-2"
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={
                    'inline-block w-2 h-2 rounded-full ' +
                    (LOG_LEVEL_COLOR_CLASS[lvl] || 'bg-neutral-300')
                  }
                />
                {lvl}
              </span>
            </ToggleGroupItem>
          )
        )}
      </ToggleGroup>
    </div>
  )
}
