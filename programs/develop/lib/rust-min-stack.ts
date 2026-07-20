// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// rspack's native worker threads get Rust's 2 MB default stack, and its AST
// passes recurse once per node, a single expression with ~4,000 chained
// operators (wild data files ship string-concat chains like this) overflows
// the stack and kills the whole process with a bare SIGILL before any
// diagnostic can print. Rust's std::thread honors RUST_MIN_STACK when the
// embedder doesn't pin an explicit size, and the value is read once at first
// thread spawn, so it must be set before @rspack/core loads its binding.
// 256 MB moves the cliff to ~200,000 chained terms (verified empirically;
// the need scales linearly with expression depth) and is a per-thread
// virtual-memory reservation only, committed pages track actual use.
export const RUST_MIN_STACK_BYTES = 256 * 1024 * 1024

export function ensureRustMinStack(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.RUST_MIN_STACK) {
    env.RUST_MIN_STACK = String(RUST_MIN_STACK_BYTES)
  }
}

ensureRustMinStack()
