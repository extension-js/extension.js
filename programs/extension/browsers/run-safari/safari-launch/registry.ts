// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'

// One appex macOS knows about, from `pluginkit -m -v`. The mark is pluginkit's
// election column: + elected, - disabled, ! unapproved, blank unspecified.
export interface PluginkitRow {
  id: string
  version: string | null
  registeredAt: string | null
  path: string | null
  mark: string | null
}

export function parsePluginkitRows(output: string): PluginkitRow[] {
  const rows: PluginkitRow[] = []

  for (const line of String(output || '').split(/\r?\n/)) {
    const match =
      /^\s*([+\-!?])?\s*([^\s(]+)(?:\(([^)]*)\))?(?:\t([^\t]*)\t([^\t]*)\t(.*))?\s*$/.exec(
        line
      )
    if (!match) continue

    rows.push({
      id: match[2],
      version: match[3] ?? null,
      registeredAt: match[5]?.trim() || null,
      path: match[6]?.trim() || null,
      mark: match[1] ?? null
    })
  }

  return rows
}

// Appexes macOS still lists from this project's own Xcode output under a
// different id: an earlier bundle id of the same extension. Safari keeps its
// switch per id, so the earlier one being on says nothing about the new one.
export function earlierAppexRows(
  rows: PluginkitRow[],
  projectLocation: string,
  currentAppexId: string
): PluginkitRow[] {
  const root = path.resolve(projectLocation) + path.sep

  return rows.filter(
    (row) =>
      row.id !== currentAppexId &&
      typeof row.path === 'string' &&
      path.resolve(row.path).startsWith(root)
  )
}

// A row of Safari's own extension registry (Extensions.plist), keyed
// `<appexId> (<TEAM>|UNSIGNED)` with the switch state per signing identity.
export interface SafariRegistryRow {
  appexId: string
  team: string
  enabled: boolean
}

export function parseSafariExtensionRegistry(
  json: string
): SafariRegistryRow[] {
  let parsed: unknown

  try {
    parsed = JSON.parse(String(json || ''))
  } catch {
    return []
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []

  const rows: SafariRegistryRow[] = []

  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    const match = /^(.+) \(([^()]+)\)$/.exec(key)
    if (!match || !value || typeof value !== 'object') continue

    const enabled = (value as {Enabled?: unknown}).Enabled

    rows.push({
      appexId: match[1],
      team: match[2],
      enabled: enabled === true || enabled === 1
    })
  }

  return rows
}

// The same appex id enabled under another signing identity. Safari runs that
// earlier build beside the fresh one and can serve its files instead.
export function staleSignedRows(
  rows: SafariRegistryRow[],
  appexId: string,
  team: string
): SafariRegistryRow[] {
  return rows.filter(
    (row) => row.appexId === appexId && row.team !== team && row.enabled
  )
}
