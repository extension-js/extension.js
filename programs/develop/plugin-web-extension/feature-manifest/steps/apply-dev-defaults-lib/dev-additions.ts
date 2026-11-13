// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {DevAddition} from '../../../../lib/dev-additions'
import {isHostPattern} from './dev-injected-hosts'

const PERMISSION_REASONS: Record<string, string> = {
  scripting:
    'the dev reload registers content scripts and injects the rebuilt files into open tabs',
  tabs: 'the dev reload finds the open tabs and extension pages a save touches and reloads them',
  storage:
    'the dev reload keeps its state in storage.local across service worker restarts'
}

const RESOURCE_REASONS: Record<string, string> = {
  'hot/*': 'a content script fetches its hot update chunks from the page',
  'extension-js-control.json':
    'a content script reads the control port again after the dev server restarts'
}

const HOST_REASON =
  'a content script matches it, and the dev reload injects the rebuilt script into open tabs on save'

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
            reason:
              PERMISSION_REASONS[permission] ||
              'the dev reload and the control bridge call it'
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

  return additions
}
