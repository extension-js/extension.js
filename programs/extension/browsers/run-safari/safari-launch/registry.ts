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
  // Safari stamps the row when it stops listing it, which is what happens to
  // an unsigned row each time Safari starts with unsigned extensions off.
  removed?: true
}

export function parseSafariExtensionRegistry(
  json: string
): SafariRegistryRow[] {
  const text = String(json || '').trim()

  // The file holds dates, which plutil cannot write as JSON, so it is read
  // as XML. JSON stays accepted for a caller that already has an object.
  if (text.startsWith('<')) return parseRegistryXml(text)

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
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
      enabled: enabled === true || enabled === 1,
      ...('RemovedDate' in (value as object) ? {removed: true as const} : {})
    })
  }

  return rows
}

const XML_TOKEN =
  /<key>([^<]*)<\/key>|<(dict|array)>|<\/(dict|array)>|<(true|false)\/>/g

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// Walks the plist's tags by depth: a key right under the root names a row,
// and the keys one level below it are that row's fields.
function parseRegistryXml(xml: string): SafariRegistryRow[] {
  const rows: SafariRegistryRow[] = []
  let depth = 0
  let row: SafariRegistryRow | null = null
  let rowName = ''
  let field = ''

  for (const token of xml.matchAll(XML_TOKEN)) {
    if (token[1] !== undefined) {
      const key = decodeXml(token[1])

      if (depth === 1) rowName = key

      if (depth === 2) {
        field = key
        if (row && key === 'RemovedDate') row.removed = true
      }

      continue
    }

    if (token[2]) {
      depth += 1

      if (depth === 2 && token[2] === 'dict') {
        const match = /^(.+) \(([^()]+)\)$/.exec(rowName)
        row = match ? {appexId: match[1], team: match[2], enabled: false} : null
      }

      continue
    }

    if (token[3]) {
      if (depth === 2 && row) rows.push(row)
      if (depth === 2) row = null

      depth -= 1

      continue
    }

    if (depth === 2 && row && field === 'Enabled') {
      row.enabled = token[4] === 'true'
    }
  }

  return rows
}

// Whether Safari is not listing this identity's row: it never saw it, or it
// dropped it. Registering the appex again is what brings it back.
export function rowDroppedBySafari(
  rows: SafariRegistryRow[],
  appexId: string,
  team: string
): boolean {
  const row = rows.find(
    (candidate) => candidate.appexId === appexId && candidate.team === team
  )

  return !row || row.removed === true
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
