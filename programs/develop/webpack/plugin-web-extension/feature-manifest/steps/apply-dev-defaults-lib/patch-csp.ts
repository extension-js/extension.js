// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import parse from 'content-security-policy-parser'
import {type Manifest} from '../../../../webpack-types'

function resolveV2Policy(policy: Manifest['content_security_policy']) {
  if (!policy) return undefined

  if (typeof policy === 'string') return policy

  if (typeof policy === 'object') {
    const extensionPages = (policy as {extension_pages?: unknown})
      .extension_pages
    if (typeof extensionPages === 'string') return extensionPages
  }

  return undefined
}

function buildCSP(cspObject: Record<string, string[]>) {
  const directives = Object.entries(cspObject).map(
    ([directive, values]) => `${directive} ${values.join(' ')}`
  )
  return directives.join('; ') + '; '
}

export function patchV2CSP(manifest: Manifest) {
  let policy: string | undefined = resolveV2Policy(
    manifest.content_security_policy
  )

  if (!policy) {
    return buildCSP({
      'script-src': ["'self'", "'unsafe-eval'", 'blob:', 'filesystem:'],
      'object-src': ["'self'", 'blob:', 'filesystem:']
    })
  }

  const csp = parse(policy)

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
  } else {
    const objectSrc = csp.get('object-src') || []
    if (!objectSrc.includes('blob:')) {
      objectSrc.push('blob:')
    }
    if (!objectSrc.includes('filesystem:')) {
      objectSrc.push('filesystem:')
    }
    csp.set('object-src', objectSrc)
  }

  const cspObject: Record<string, string[]> = Object.fromEntries(csp.entries())
  return buildCSP(cspObject)
}

export function patchV3CSP(manifest: Manifest) {
  const policy = manifest.content_security_policy

  if (!policy) {
    return {
      extension_pages: buildCSP({
        'script-src': ["'self'"],
        'object-src': ["'self'"]
      })
    }
  }

  const csp = parse(policy.extension_pages || '')
  const defaultDirectives = {
    'script-src': ["'self'"],
    'object-src': ["'self'"]
  }

  for (const directive in defaultDirectives) {
    if (!csp.get(directive)) {
      csp.set(
        directive,
        defaultDirectives[directive as keyof typeof defaultDirectives]
      )
    }
  }

  const cspObject: Record<string, string[]> = Object.fromEntries(csp.entries())
  const extensionPagesPolicy = buildCSP(cspObject)

  return {
    extension_pages: extensionPagesPolicy
  }
}
