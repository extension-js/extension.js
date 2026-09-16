// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const WILDCARD_HOSTS: ReadonlySet<string> = new Set([
  '0.0.0.0',
  '::',
  '[::]',
  '::0',
  '0.0.0.0.0',
  '*',
  ''
])

export function isWildcardHost(host: string | undefined | null): boolean {
  return WILDCARD_HOSTS.has(String(host ?? '').trim())
}

export function resolveConnectableHost(
  bindHost: string | undefined | null,
  publicHost?: string | undefined | null
): string {
  const override = String(publicHost ?? '').trim()
  if (override) return override

  const bind = String(bindHost ?? '').trim()
  if (isWildcardHost(bind)) return '127.0.0.1'

  return bind || '127.0.0.1'
}
