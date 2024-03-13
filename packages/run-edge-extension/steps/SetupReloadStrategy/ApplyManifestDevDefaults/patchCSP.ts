import parse from 'content-security-policy-parser'
import {type ManifestBase} from '../../../manifest-types'

export function patchV2CSP(manifest: ManifestBase) {
  let policy: string | undefined = manifest.content_security_policy

  if (!policy) {
    return (
      "script-src 'self' 'unsafe-eval' blob: filesystem:; " +
      "object-src 'self' blob: filesystem:; "
    )
  }

  const csp = parse(policy)
  policy = ''

  // Modification logic remains the same
  if (!csp['script-src']) {
    csp['script-src'] = ["'self' 'unsafe-eval' blob: filesystem:"]
  }
  if (!csp['script-src'].includes("'unsafe-eval'")) {
    csp['script-src'].push("'unsafe-eval'")
  }

  for (const k in csp) {
    policy += `${k} ${csp[k].join(' ')};`
  }

  return policy
}

export function patchV3CSP(manifest: ManifestBase) {
  // Extract the CSP for extension_pages
  const policy: {extension_pages: string} | undefined =
    manifest.content_security_policy

  if (!policy) {
    return {
      extension_pages: "script-src 'self'; " + "object-src 'self'; "
    }
  }

  const csp = parse(policy.extension_pages)
  let extensionPagesPolicy = ''

  for (const directive in csp) {
    extensionPagesPolicy += `${directive} ${csp[directive].join(' ')}; `
  }

  return {
    extension_pages: extensionPagesPolicy.trim()
  }
}
