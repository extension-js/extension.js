// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

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
