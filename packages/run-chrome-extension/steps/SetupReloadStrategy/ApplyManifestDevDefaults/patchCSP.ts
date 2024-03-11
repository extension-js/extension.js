import parse from 'content-security-policy-parser'
import {type ManifestBase} from '../../../manifest-types'

export function patchV2CSP(manifest: ManifestBase) {
  let policy: string | undefined = manifest.content_security_policy

  if (!policy) {
    return (
      "script-src 'self' 'unsafe-eval' blob: filesystem:; " +
      "object-src 'self' blob: filesystem:; " // +
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

  // Update the CSP in the manifest
  return policy
}

export function patchV3CSP(manifest: ManifestBase) {
  // Extract the CSP for extension_pages
  const policy: {extension_pages: string} | undefined =
    manifest.content_security_policy

  // Check if a policy exists, if not, apply a default one
  if (!policy) {
    return {
      extension_pages: "script-src 'self'; " + "object-src 'self'; " // + "connect-src 'self' ws:;"
    }
  }

  // Parse the CSP to a manageable format
  const csp = parse(policy.extension_pages)
  let extensionPagesPolicy = ''

  // Rebuild the CSP string
  for (const directive in csp) {
    extensionPagesPolicy += `${directive} ${csp[directive].join(' ')}; `
  }

  // Update the manifest's CSP
  return {
    extension_pages: extensionPagesPolicy.trim()
  }
}
