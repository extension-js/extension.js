// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {DevAddition} from '../../../../lib/dev-additions'
import {isHostPattern} from '../../manifest-lib/dev-injected-hosts'

const PERMISSION_REASONS: Record<string, string> = {
  scripting:
    'the dev session registers content scripts and injects the rebuilt files into open tabs',
  tabs: 'the dev session finds the open tabs and extension pages a save touches and loads them again',
  storage:
    'the dev session keeps its state in storage.local across service worker restarts'
}

const RESOURCE_REASONS: Record<string, string> = {
  'hot/*': 'a content script fetches its hot update chunks from the page',
  'extension-js-control.json':
    'a content script reads the control port again after the dev server restarts'
}

const UNSAFE_EVAL = "'unsafe-eval'"

const HOST_REASON =
  'a content script matches it, and the dev session injects the rebuilt script into open tabs on save'

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

// Only the keys a grant lives under, since a patched manifest is wider than
// the manifest type in its other keys.
interface ManifestGrants {
  permissions?: unknown
  host_permissions?: unknown
  web_accessible_resources?: unknown
  content_security_policy?: unknown
  externally_connectable?: unknown
  background?: unknown
}

interface ResourceGrant {
  resource: string
  matches?: string[]
}

function resourceGrants(manifest: ManifestGrants): ResourceGrant[] {
  const declared = manifest.web_accessible_resources
  if (!Array.isArray(declared)) return []

  return declared.flatMap((entry): ResourceGrant[] => {
    if (typeof entry === 'string') return [{resource: entry}]

    const group = entry as {resources?: unknown; matches?: unknown}
    const matches = strings(group?.matches).sort()

    return strings(group?.resources).map((resource) => ({resource, matches}))
  })
}

function grantKey(grant: ResourceGrant): string {
  return JSON.stringify([grant.resource, grant.matches ?? null])
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

// The policy extension pages run under: the whole string on Manifest V2,
// the extension_pages slot on Manifest V3.
function pagesPolicy(manifest: ManifestGrants): string {
  const policy = manifest.content_security_policy
  if (typeof policy === 'string') return policy

  const pages = record(policy).extension_pages

  return typeof pages === 'string' ? pages : ''
}

function backgroundEntry(manifest: ManifestGrants): string | undefined {
  const background = record(manifest.background)
  const scripts = strings(background.scripts)

  if (typeof background.service_worker === 'string') {
    return `background.service_worker ${background.service_worker}`
  }

  if (scripts.length) return `background.scripts ${scripts.join(' ')}`

  return typeof background.page === 'string'
    ? `background.page ${background.page}`
    : undefined
}

// The dev-only changes that are no grant list: a looser pages policy, an
// opened connect list, a background kept alive, a background added.
function listManifestChanges(
  source: ManifestGrants,
  dev: ManifestGrants
): DevAddition[] {
  const changes: DevAddition[] = []
  const change = (value: string, reason: string) =>
    changes.push({kind: 'manifest_change', value, reason})

  if (
    pagesPolicy(dev).includes(UNSAFE_EVAL) &&
    !pagesPolicy(source).includes(UNSAFE_EVAL)
  ) {
    change(
      `content_security_policy ${UNSAFE_EVAL}`,
      'the dev build of a Manifest V2 extension opens script-src to eval, blob and filesystem sources for the dev runtime'
    )
  }

  const sourceConnectable = record(source.externally_connectable)
  const devIds = strings(record(dev.externally_connectable).ids)

  if (devIds.includes('*') && !strings(sourceConnectable.ids).includes('*')) {
    change(
      'externally_connectable.ids *',
      'externally_connectable without ids closes the extension to every other extension, so the dev build reopens it'
    )
  }

  const sourceEntry = backgroundEntry(source)
  const devEntry = backgroundEntry(dev)

  if (!sourceEntry && devEntry) {
    change(
      devEntry,
      'the manifest declares no background, and the dev session runs its control channel in one'
    )
  } else if (
    record(dev.background).persistent === true &&
    record(source.background).persistent === false
  ) {
    change(
      'background.persistent true',
      'an event page idles out and takes the dev control channel with it'
    )
  }

  return changes
}

// What the dev manifest holds that the manifest it was patched from does not.
// A diff, so a grant added to the patch can never go unreported.
export function listDevManifestAdditions(
  source: ManifestGrants,
  dev: ManifestGrants
): DevAddition[] {
  const additions: DevAddition[] = []
  const sourcePermissions = new Set(strings(source.permissions))

  for (const permission of strings(dev.permissions)) {
    if (sourcePermissions.has(permission)) continue

    additions.push(
      isHostPattern(permission)
        ? {kind: 'host_permission', value: permission, reason: HOST_REASON}
        : {
            kind: 'permission',
            value: permission,
            reason: PERMISSION_REASONS[permission] || 'the dev session calls it'
          }
    )
  }

  const sourceHosts = new Set(strings(source.host_permissions))

  for (const host of strings(dev.host_permissions)) {
    if (sourceHosts.has(host)) continue

    additions.push({kind: 'host_permission', value: host, reason: HOST_REASON})
  }

  const sourceGrants = new Set(resourceGrants(source).map(grantKey))

  for (const grant of resourceGrants(dev)) {
    if (sourceGrants.has(grantKey(grant))) continue

    additions.push({
      kind: 'web_accessible_resource',
      value: grant.resource,
      ...(grant.matches ? {matches: grant.matches} : {}),
      reason:
        RESOURCE_REASONS[grant.resource] ||
        'the dev runtime fetches it from a page'
    })
  }

  return [...additions, ...listManifestChanges(source, dev)]
}
