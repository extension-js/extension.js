import parse from 'content-security-policy-parser'
import {ManifestBase} from '../../../manifest-types'

export function patchV2CSP(manifest: ManifestBase) {
  let policy: string | undefined = manifest.content_security_policy

  if (!policy) {
    manifest.content_security_policy =
      "script-src 'self' 'unsafe-eval' blob: filesystem:; " +
      "object-src 'self' blob: filesystem:; " +
      'connect-src ws:;'
    return manifest
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
  if (!csp['connect-src']) {
    csp['connect-src'] = ['ws:']
  } else {
    if (!csp['connect-src'].includes('ws:')) {
      csp['connect-src'].push('ws:')
    }
  }
  for (const k in csp) {
    policy += `${k} ${csp[k].join(' ')};`
  }

  // Update the CSP in the manifest
  return policy
}

export function patchV3CSP(manifest: ManifestBase) {
  // Extract the CSP for extension_pages
  let policy: {extension_pages: string} | undefined =
    manifest.content_security_policy

  // Check if a policy exists, if not, apply a default one
  if (!policy) {
    return {
      extension_pages:
        "script-src 'self'; " + "object-src 'self'; " + 'connect-src ws:;'
    }
  }

  // Parse the CSP to a manageable format
  const csp = parse(policy.extension_pages)
  let extensionPagesPolicy = ''

  // Ensure 'connect-src' is present and includes 'ws:' if not already
  const hasConnectSrc = csp['connect-src'] && csp['connect-src'].length > 0
  if (hasConnectSrc) {
    if (!csp['connect-src'].includes('ws:')) {
      csp['connect-src'].push('ws:')
    }
  } else {
    csp['connect-src'] = ["'self'", 'ws:']
  }

  // Rebuild the CSP string
  for (const directive in csp) {
    extensionPagesPolicy += `${directive} ${csp[directive].join(' ')}; `
  }

  // Update the manifest's CSP
  return {
    extension_pages: extensionPagesPolicy.trim()
  }
}
