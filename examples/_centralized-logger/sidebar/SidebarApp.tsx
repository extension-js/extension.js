import React, {useEffect, useMemo, useState} from 'react'

import {Toaster} from '@/components/ui/sonner'

// Components
import {FiltersRow} from './controls/FiltersRow'
import {SettingsAside} from './controls/SettingsAside'
import {ActionsRow} from './controls/ActionsRow'
import {LogTableView} from './log-table'

import type {LogLevel, LoggerContext, LogEvent} from '@/types/logger'
import {
  formatMessageParts,
  getContextColorClass,
  exportLogs
} from '@/lib/logger'

export default function SidebarApp() {
  const [events, setEvents] = useState<LogEvent[]>([])
  const [contextFilter, setContextFilter] = useState<LoggerContext | 'all'>(
    'all'
  )
  const [tabFilter, setTabFilter] = useState<number | 'all'>('all')
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [paused, setPaused] = useState(false)
  const [pausedSnapshot, setPausedSnapshot] = useState<LogEvent[] | null>(null)

  useEffect(() => {
    const port = chrome.runtime.connect({name: 'logger'})
    port.postMessage({type: 'subscribe'})

    const onMessage = (msg: {
      type: 'init' | 'append'
      events?: LogEvent[]
      event?: LogEvent
    }) => {
      if (msg?.type === 'init') {
        setEvents(msg.events || [])
      } else if (msg?.type === 'append' && msg.event) {
        const event: LogEvent = msg.event
        setEvents((prev) => [...prev, event].slice(-1000))
      }
    }
    port.onMessage.addListener(onMessage)

    return () => {
      try {
        port.onMessage.removeListener(onMessage)
        port.disconnect()
      } catch {}
    }
  }, [])

  // Load persisted UI settings
  useEffect(() => {
    try {
      chrome.storage.session.get(
        ['logger_context', 'logger_tab', 'logger_level', 'logger_autoscroll'],
        (data) => {
          if (data?.logger_context) {
            setContextFilter(data.logger_context)
            return
          }

          if (typeof data?.logger_tab !== 'undefined') {
            setTabFilter(data.logger_tab)
            return
          }

          if (data?.logger_level) {
            setLevelFilter(data.logger_level)
            return
          }

          if (typeof data?.logger_autoscroll === 'boolean') {
            setAutoScroll(data.logger_autoscroll)
            return
          }
        }
      )
    } catch {}
  }, [])

  // Persist on change
  useEffect(() => {
    try {
      chrome.storage.session.set({
        logger_context: contextFilter,
        logger_tab: tabFilter,
        logger_level: levelFilter,
        logger_autoscroll: autoScroll
      })
    } catch {}
  }, [contextFilter, tabFilter, levelFilter, autoScroll])

  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    return events.filter((e) => {
      if (contextFilter !== 'all' && e.context !== contextFilter) {
        return false
      }

      if (tabFilter !== 'all' && e.tabId !== tabFilter) {
        return false
      }

      if (levelFilter !== 'all' && e.level !== levelFilter) {
        return false
      }

      if (query) {
        const text = formatMessageParts(e.messageParts).toLowerCase()
        const inUrl = (e.url || '').toLowerCase().includes(query)

        if (!text.includes(query) && !inUrl) {
          return false
        }
      }
      return true
    })
  }, [events, contextFilter, tabFilter, levelFilter, debouncedSearch])

  const uniqueTabs = useMemo(() => {
    const set = new Set<number>()
    for (const event of events) {
      if (typeof event.tabId === 'number') {
        set.add(event.tabId)
      }
    }

    return Array.from(set.values()).sort((a, b) => a - b)
  }, [events])

  const tabMeta = useMemo(() => {
    const map = new Map<number, {url?: string}>()

    for (const event of events) {
      if (typeof event.tabId === 'number') {
        if (event.url) map.set(event.tabId, {url: event.url})
        else if (!map.has(event.tabId)) map.set(event.tabId, {url: undefined})
      }
    }

    const obj: Record<number, {url?: string}> = {}

    for (const [key, value] of map.entries()) {
      obj[key] = value
    }

    return obj
  }, [events])

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput), 200)
    return () => clearTimeout(id)
  }, [searchInput])

  return (
    <div className="sidebar_app">
      <style>
        {`
        :root { color-scheme: light dark; }
        /* Fixed controls height and full-height table */
        .sidebar_app { height: 100vh; }
        .sidebar_app section.controls { height: 65px; margin: 0; padding: 0; }
        /* respect p-2 outer gutter (8px top + 8px bottom) */
        .sidebar_app .log-container { height: calc(100vh - 65px - 25px); }
      `}
      </style>
      <Toaster />
      <div className="contents grid p-2 gap-2 h-screen">
        <div className="flex items-center gap-1.5 flex-wrap">
          <FiltersRow
            contextFilter={contextFilter}
            setContextFilter={(v) => setContextFilter(v)}
            tabFilter={tabFilter}
            setTabFilter={setTabFilter}
            levelFilter={levelFilter}
            setLevelFilter={(v) => setLevelFilter(v)}
            uniqueTabs={uniqueTabs}
            tabMeta={tabMeta}
            getContextColorClass={getContextColorClass}
          />
          <SettingsAside />
        </div>

        <ActionsRow
          autoScroll={autoScroll}
          setAutoScroll={setAutoScroll}
          search={searchInput}
          setSearch={setSearchInput}
          paused={paused}
          setPaused={setPaused}
          onClear={() => setEvents([])}
          onExportJson={() =>
            exportLogs(paused ? pausedSnapshot || [] : filtered, 'json')
          }
          onExportNdjson={() =>
            exportLogs(paused ? pausedSnapshot || [] : filtered, 'ndjson')
          }
        />

        <LogTableView
          events={paused ? pausedSnapshot || [] : filtered}
          autoScroll={autoScroll && !paused}
          searchQuery={debouncedSearch}
        />
      </div>
    </div>
  )
}
