// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'

const MV2_HOST_KEYS = ['host_permissions', 'optional_host_permissions'] as const

function appendUnique(base: unknown, extra: unknown): string[] {
  const list = [
    ...(Array.isArray(base) ? base : []),
    ...(Array.isArray(extra) ? extra : [])
  ].filter((entry): entry is string => typeof entry === 'string')

  return [...new Set(list)]
}

// Manifest V2 has no host_permissions key. Firefox reads a match pattern
// from permissions next to the API names, so both host lists fold in there.
export function hostPermissions(manifest: Manifest) {
  if (manifest.manifest_version !== 2) return undefined

  const result: Record<string, string[]> = {}

  if (Array.isArray(manifest.host_permissions)) {
    result.permissions = appendUnique(
      manifest.permissions,
      manifest.host_permissions
    )
  }

  if (Array.isArray(manifest.optional_host_permissions)) {
    result.optional_permissions = appendUnique(
      manifest.optional_permissions,
      manifest.optional_host_permissions
    )
  }

  return Object.keys(result).length ? result : undefined
}

// The source manifest is spread under the overrides, so the folded keys
// come back unless the writer drops them after the merge.
export function dropMv2HostKeys<T extends Record<string, unknown>>(
  manifest: T
): T {
  if (manifest.manifest_version !== 2) return manifest

  const rest: Record<string, unknown> = {...manifest}
  for (const key of MV2_HOST_KEYS) delete rest[key]

  return rest as T
}
