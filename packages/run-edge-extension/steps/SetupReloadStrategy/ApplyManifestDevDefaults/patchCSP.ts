import parse from 'content-security-policy-parser'
import {ManifestBase} from '../../../manifest-types'

export function patchV2CSP(manifest: ManifestBase) {
  let policy = manifest.content_security_policy

  if (!policy) {
    manifest.content_security_policy =
      "script-src 'self' 'unsafe-eval' blob: filesystem:;" +
      "object-src 'self' blob: filesystem:;" +
      'connect-src ws: wss:;'
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
    csp['connect-src'] = ['ws:', 'wss:']
  } else {
    if (!csp['connect-src'].includes('ws:')) {
      csp['connect-src'].push('ws:')
    }
  }
  for (const k in csp) {
    policy += `${k} ${csp[k].join(' ')};`
  }

  manifest.content_security_policy = policy // Update the CSP in the manifest
  return manifest
}

export function patchV3CSP(manifest: ManifestBase) {
  // Extract the CSP for extension_pages
  let policy = manifest.content_security_policy.extension_pages

  // Check if a policy exists, if not, apply a default one
  if (!policy) {
    manifest.content_security_policy.extension_pages =
      "connect-src 'self' ws: wss:;"
    return manifest
  }

  // Parse the CSP to a manageable format
  const csp = parse(policy)
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
  manifest.content_security_policy.extension_pages = extensionPagesPolicy.trim()

  return manifest
}
