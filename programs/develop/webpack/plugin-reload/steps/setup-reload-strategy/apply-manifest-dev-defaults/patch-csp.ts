import parse from 'content-security-policy-parser'
import {type Manifest} from '../../../../webpack-types'

function buildCSP(cspObject: Record<string, string[]>) {
  let policy = ''
  for (const directive in cspObject) {
    policy += `${directive} ${cspObject[directive].join(' ')}; `
  }
  return policy.trim()
}

// Function for Manifest V2 CSP patching
export function patchV2CSP(manifest: Manifest) {
  let policy: string | undefined = manifest.content_security_policy

  if (!policy) {
    // Default V2 policy if none is provided
    return (
      "script-src 'self' 'unsafe-eval' blob: filesystem:; " +
      "object-src 'self' blob: filesystem:; "
    )
  }

  const csp = parse(policy)

  // Ensure necessary policies for Manifest V2
  if (!csp.get('script-src')) {
    csp.set('script-src', ["'self'", "'unsafe-eval'", 'blob:', 'filesystem:'])
  } else {
    const scriptSrc = csp.get('script-src') || []
    if (!scriptSrc.includes("'unsafe-eval'")) {
      scriptSrc.push("'unsafe-eval'")
    }
    if (!scriptSrc.includes('blob:')) {
      scriptSrc.push('blob:')
    }
    if (!scriptSrc.includes('filesystem:')) {
      scriptSrc.push('filesystem:')
    }
    csp.set('script-src', scriptSrc)
  }

  if (!csp.get('object-src')) {
    csp.set('object-src', ["'self'", 'blob:', 'filesystem:'])
  }

  // Rebuild the policy string
  const cspObject: Record<string, string[]> = Object.fromEntries(csp.entries())
  return buildCSP(cspObject)
}

// Function for Manifest V3 CSP patching
export function patchV3CSP(manifest: Manifest) {
  const policy = manifest.content_security_policy

  if (!policy) {
    // Default V3 policy if none is provided
    return {
      extension_pages: "script-src 'self'; object-src 'self';"
    }
  }

  const csp = parse(policy.extension_pages || '')
  const defaultDirectives = {}

  // Merge with default directives if not present
  for (const directive in defaultDirectives) {
    if (!csp.get(directive)) {
      csp.set(
        directive,
        defaultDirectives[directive as keyof typeof defaultDirectives]
      )
    }
  }

  // Rebuild the extension pages policy
  const cspObject: Record<string, string[]> = Object.fromEntries(csp.entries())
  const extensionPagesPolicy = buildCSP(cspObject)

  return {
    extension_pages: extensionPagesPolicy
  }
}
