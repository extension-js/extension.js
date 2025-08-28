import React from 'react'
import {
  Download as DownloadIcon,
  EraserIcon,
  Pause as PauseIcon,
  Play as PlayIcon
} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import {Input} from '@/components/ui/input'

export type ActionsRowProps = {
  autoScroll: boolean
  setAutoScroll: (value: boolean) => void
  search: string
  setSearch: (value: string) => void
  paused: boolean
  setPaused: (value: boolean) => void
  onClear: () => void
  onExportJson: () => void
  onExportNdjson: () => void
}

export function ActionsRow({
  autoScroll,
  setAutoScroll,
  search,
  setSearch,
  paused,
  setPaused,
  onClear,
  onExportJson,
  onExportNdjson
}: ActionsRowProps) {
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
  }
  const handleTogglePause = () => {
    setPaused(!paused)
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button
        className="h-7 px-2 text-xs"
        variant="secondary"
        onClick={onClear}
      >
        <span className="inline-flex items-center gap-1.5">
          <EraserIcon className="h-3 w-3" />
          Clear
        </span>
      </Button>
      <div className="inline-flex items-center gap-1.5 min-w-[110px]">
        <Label htmlFor="autoscroll" className="text-xs">
          Auto-scroll
        </Label>
        <Switch
          id="autoscroll"
          checked={autoScroll}
          onCheckedChange={setAutoScroll}
        />
      </div>
      <Input
        placeholder="Search messages/URL..."
        value={search}
        onChange={handleSearchChange}
        className="h-7 px-2 text-xs"
      />
      <Button
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={handleTogglePause}
      >
        <span className="inline-flex items-center gap-1.5">
          {paused ? (
            <PlayIcon className="h-2 w-2" />
          ) : (
            <PauseIcon className="h-2 w-2" />
          )}
          {paused ? 'Resume' : 'Pause'}
        </span>
      </Button>
      <Button
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={onExportJson}
      >
        <span className="inline-flex items-center gap-1.5">
          <DownloadIcon className="h-2 w-2" />
          Export JSON
        </span>
      </Button>
      <Button
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={onExportNdjson}
      >
        <span className="inline-flex items-center gap-1.5">
          <DownloadIcon className="h-2 w-2" />
          Export NDJSON
        </span>
      </Button>
    </div>
  )
}
