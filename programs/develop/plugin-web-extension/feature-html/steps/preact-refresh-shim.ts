// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

/**
 * Defensive prefresh / react-refresh global shim.
 *
 * This module runs first in every HTML entry chain and installs no-op
 * fallbacks. When a working refresh plugin is installed (for example,
 * `@rspack/plugin-preact-refresh@1.1.5+`), its intercept overwrites these
 * fallbacks per-module factory and restores them afterwards — the shim is
 * a transparent backstop. When a broken plugin is installed, the user's
 * bundle still evaluates: fast-refresh is a no-op, but the page renders
 * and live-reload works as expected
 */
const g: Record<string, unknown> =
  typeof globalThis !== 'undefined'
    ? (globalThis as unknown as Record<string, unknown>)
    : ({} as Record<string, unknown>)

if (typeof g.$RefreshReg$ !== 'function') {
  g.$RefreshReg$ = function () {}
}

if (typeof g.$RefreshSig$ !== 'function') {
  g.$RefreshSig$ = function () {
    return function (type: unknown) {
      return type
    }
  }
}

export {}
