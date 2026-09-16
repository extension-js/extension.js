// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'

type PolicyObject = {extension_pages?: unknown; sandbox?: unknown}

function asPolicyObject(policy: unknown): PolicyObject | undefined {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return undefined
  }

  return policy as PolicyObject
}

// Manifest V2 reads content_security_policy as one string, the MV3 object
// form fails AMO validation. The extension_pages slot is that string.
export function contentSecurityPolicy(manifest: Manifest) {
  if (manifest.manifest_version !== 2) return undefined

  const policy = asPolicyObject(manifest.content_security_policy)
  if (!policy) return undefined
  if (typeof policy.extension_pages !== 'string') return undefined

  return {content_security_policy: policy.extension_pages}
}

// MV2 has no slot for a sandbox policy inside content_security_policy, so
// an object that carries one loses it on the way to the string form.
export function hasMv2SandboxPolicy(manifest: Manifest) {
  if (manifest.manifest_version !== 2) return false

  const policy = asPolicyObject(manifest.content_security_policy)

  return typeof policy?.sandbox === 'string'
}

// The source manifest is spread under the overrides, so a sandbox-only
// object survives the merge unless the writer drops it after.
export function dropMv2ObjectPolicy<T extends Record<string, unknown>>(
  manifest: T
): T {
  if (manifest.manifest_version !== 2) return manifest
  if (!asPolicyObject(manifest.content_security_policy)) return manifest

  const {content_security_policy: _dropped, ...rest} = manifest

  return rest as unknown as T
}
