// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export interface ChunkLike {
  files?: Iterable<string> | null
}

// The slice of an rspack Entrypoint the chunk-graph readers need. Kept
// structural so specs can hand in a plain object.
export interface EntrypointLike {
  getFiles(): string[]
  getRuntimeChunk?(): ChunkLike | null | undefined
  getEntrypointChunk?(): ChunkLike | null | undefined
}

const HOT_UPDATE_FILE = /\.hot-update\.m?js$/i
// Hot update chunks are emitted into `hot/` at the bundle root, and some
// arrive without the `.hot-update` infix. Anchored, so that a user page under
// its own `hot/` folder keeps its chunk.
const HOT_UPDATE_DIR = /^hot\//i

export function isJsFile(file: string): boolean {
  return (
    /\.m?js$/i.test(file) &&
    !HOT_UPDATE_FILE.test(file) &&
    !HOT_UPDATE_DIR.test(file)
  )
}

// Every JavaScript file the entry must load before it runs: the runtime
// chunk first, then the group's own files in load order, deduplicated.
export function initialJsFiles(entrypoint: EntrypointLike): string[] {
  const files = new Set<string>()
  const runtimeChunk = entrypoint.getRuntimeChunk?.()
  for (const file of runtimeChunk?.files || []) {
    if (isJsFile(file)) files.add(file)
  }
  for (const file of entrypoint.getFiles()) {
    if (isJsFile(file)) files.add(file)
  }
  return [...files]
}

// The file the surface actually references: the entry chunk's own script,
// or the file named after the entry when the chunk does not say.
export function entryOwnJsFile(
  entryName: string,
  entrypoint: EntrypointLike,
  files: string[]
): string | undefined {
  const entryChunk = entrypoint.getEntrypointChunk?.()
  for (const file of entryChunk?.files || []) {
    if (isJsFile(file) && files.includes(file)) return file
  }
  const byName = new RegExp(
    `^${entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[a-z0-9]+)?\\.m?js$`,
    'i'
  )
  // No guess when neither lookup answers, because the caller drops this file
  // from the page markup and a wrong answer deletes a chunk the page needs.
  return files.find((file) => byName.test(file))
}
