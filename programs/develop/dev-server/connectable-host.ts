// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// The dev server binds to one host (`--host`, e.g. 0.0.0.0 for a
// Docker/devcontainer) but clients, the in-page HMR WebSocket and the
// service-worker control-bridge producer, need a host they can actually dial.
// A wildcard bind address (0.0.0.0, ::) is not a connectable client host, so
// baking it into the client URLs breaks HMR and the reload bridge under
// `--host 0.0.0.0`, headless/CI, and remote/devcontainer workflows.
//
// resolveConnectableHost derives the client-facing host from the bind host:
//   - an explicit `publicHost` override always wins (the true-remote case where
//     the browser runs on a different machine than the dev server);
//   - a wildcard/unspecified bind host falls back to loopback (127.0.0.1), the
//     correct target for the common port-forwarded devcontainer setup;
//   - any concrete bind host (an IP or hostname) is already connectable as-is.

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
