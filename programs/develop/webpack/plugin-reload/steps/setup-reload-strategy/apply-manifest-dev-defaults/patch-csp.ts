import parse from 'content-security-policy-parser'
import {type Manifest} from '../../../../../types'

export function patchV2CSP(manifest: Manifest) {
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
  if (!csp.get('script-src')) {
    csp.set('script-src', ["'self' 'unsafe-eval' blob: filesystem:"])
  }
  if (!csp.get('script-src')?.includes("'unsafe-eval'")) {
    csp.set('script-src', ['unsafe-eval'])
  }

  for (const k in csp) {
    policy += `${k} ${csp.get(k)?.join(' ')};`
  }

  return policy
}

export function patchV3CSP(manifest: Manifest) {
  // Extract the CSP for extension_pages
  const policy = manifest.content_security_policy

  if (!policy) {
    return {
      extension_pages: "script-src 'self'; " + "object-src 'self'; "
    }
  }

  const csp = parse(policy.extension_pages || '')
  let extensionPagesPolicy = ''

  for (const directive in csp) {
    extensionPagesPolicy += `${directive} ${csp.get(directive)?.join(' ')}; `
  }

  return {
    extension_pages: extensionPagesPolicy.trim()
  }
}
