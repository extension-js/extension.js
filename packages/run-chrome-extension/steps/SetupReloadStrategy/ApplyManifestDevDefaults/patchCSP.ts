import parse from 'content-security-policy-parser'

export function patchV2CSP(policy: string) {
  if (!policy) {
    return {
      content_security_policy:
        "script-src 'self' 'unsafe-eval' blob: filesystem:;" +
        "object-src 'self' blob: filesystem:;"
    }
  }

  const csp = parse(policy)
  policy = ''

  if (!csp['script-src']) {
    csp['script-src'] = ["'self' 'unsafe-eval' blob: filesystem:"]
  }

  if (!csp['script-src'].includes("'unsafe-eval'")) {
    csp['script-src'].push("'unsafe-eval'")
  }

  for (const k in csp) {
    policy += `${k} ${csp[k].join(' ')};`
  }

  return {content_security_policy: policy}
}
