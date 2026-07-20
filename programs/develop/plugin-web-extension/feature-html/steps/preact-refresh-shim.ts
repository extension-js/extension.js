// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

// Defensive prefresh/react-refresh shim: runs first in every HTML entry chain,
// installs no-op fallbacks a working plugin overwrites per-module factory.
const g: Record<string, unknown> =
  typeof globalThis !== 'undefined'
    ? (globalThis as unknown as Record<string, unknown>)
    : ({} as Record<string, unknown>)

if (typeof g.$RefreshReg$ !== 'function') {
  g.$RefreshReg$ = () => {}
}

if (typeof g.$RefreshSig$ !== 'function') {
  g.$RefreshSig$ = () => (type: unknown) => type
}

export {}
