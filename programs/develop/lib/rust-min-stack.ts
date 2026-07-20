// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// rspack's Rust AST passes recurse per node and overflow the 2MB default stack
// on long operator chains (bare SIGILL); set RUST_MIN_STACK before @rspack/core loads.
export const RUST_MIN_STACK_BYTES = 256 * 1024 * 1024

export function ensureRustMinStack(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.RUST_MIN_STACK) {
    env.RUST_MIN_STACK = String(RUST_MIN_STACK_BYTES)
  }
}

ensureRustMinStack()
