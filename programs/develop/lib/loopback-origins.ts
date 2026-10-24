// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export interface LoopbackOrigin {
  pattern: string
  where: string
}

function hostOf(pattern: string): string | null {
  const match = /^(?:\*|[a-z][a-z0-9+.-]*):\/\/(\[[^\]]+\]|[^/:]+)/i.exec(
    pattern.trim()
  )

  return match ? match[1].toLowerCase() : null
}

export function isLoopbackPattern(pattern: unknown): boolean {
  if (typeof pattern !== 'string') return false

  const host = hostOf(pattern)
  if (!host) return false

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '[::1]' || host === '0.0.0.0') return true

  return /^127(?:\.\d{1,3}){3}$/.test(host)
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function findLoopbackOrigins(manifest: unknown): LoopbackOrigin[] {
  if (!manifest || typeof manifest !== 'object') return []

  const m = manifest as Record<string, unknown>
  const found: LoopbackOrigin[] = []

  const add = (patterns: string[], where: string) => {
    for (const pattern of patterns) {
      if (isLoopbackPattern(pattern)) found.push({pattern, where})
    }
  }

  const contentScripts = Array.isArray(m.content_scripts)
    ? m.content_scripts
    : []

  contentScripts.forEach((entry, index) => {
    if (entry && typeof entry === 'object') {
      add(
        strings((entry as {matches?: unknown}).matches),
        `content_scripts[${index}].matches`
      )
    }
  })

  add(strings(m.host_permissions), 'host_permissions')
  add(strings(m.optional_host_permissions), 'optional_host_permissions')
  // Manifest V2 lists host patterns among the permissions.
  add(strings(m.permissions), 'permissions')
  add(strings(m.optional_permissions), 'optional_permissions')

  const externally = m.externally_connectable

  if (externally && typeof externally === 'object') {
    add(
      strings((externally as {matches?: unknown}).matches),
      'externally_connectable.matches'
    )
  }

  const resources = Array.isArray(m.web_accessible_resources)
    ? m.web_accessible_resources
    : []

  resources.forEach((entry, index) => {
    if (entry && typeof entry === 'object') {
      add(
        strings((entry as {matches?: unknown}).matches),
        `web_accessible_resources[${index}].matches`
      )
    }
  })

  return found
}
