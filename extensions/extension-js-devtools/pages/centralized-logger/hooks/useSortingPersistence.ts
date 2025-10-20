import {useEffect, useState} from 'react'
import type {SortingState} from '@tanstack/react-table'

export function useSortingPersistence(storageKey = 'logger_table_sorting') {
  const [sorting, setSorting] = useState<SortingState>([])

  const setTimeOnlySorting = (
    updater: SortingState | ((old: SortingState) => SortingState)
  ) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater

    const filtered = Array.isArray(next)
      ? next.filter((s) => s.id === 'time')
      : []

    setSorting(filtered)
  }

  useEffect(() => {
    try {
      chrome.storage.session.get([storageKey], (data) => {
        const val = data?.[storageKey]

        if (Array.isArray(val)) setTimeOnlySorting(val)
      })
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      chrome.storage.session.set({[storageKey]: sorting})
    } catch {}
  }, [sorting, storageKey])

  return {sorting, setTimeOnlySorting}
}
