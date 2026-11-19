// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const awaitingRestart = new WeakSet<object>()
const heldBuilds = new WeakSet<object>()

// The compiler's MAIN world set differs from the one it was made with, so
// it waits on a restart that reloads once. This build is the first it replaces.
export function holdForMainWorldRestart(
  compiler: object,
  compilation: object
): void {
  awaitingRestart.add(compiler)
  heldBuilds.add(compilation)
}

// A build made while the set differed. A slow one can end after the set was
// taken back, and it still must not reload for what it was built with.
export function holdBuildForMainWorldRestart(compilation: object): void {
  heldBuilds.add(compilation)
}

// The set is back to what the compiler was made with, or the restart did not
// take. Builds already held stay held.
export function releaseMainWorldRestartHold(compiler: object): void {
  awaitingRestart.delete(compiler)
}

// True for a build the restart is about to replace. Reloading for it too
// would start the background twice for the one edit.
export function isAwaitingMainWorldRestart(
  compiler: object | undefined,
  compilation?: object
): boolean {
  if (compilation != null && heldBuilds.has(compilation)) return true

  return compiler != null && awaitingRestart.has(compiler)
}
