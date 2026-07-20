//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Unflagged require(esm) landed in Node 22.12; older runtimes crash with a
// bare ERR_REQUIRE_ESM before any CLI code runs, so the floor is 22.12.
const MIN_NODE_MAJOR = 22
const MIN_NODE_MINOR = 12

export function isSupportedNodeVersion(version: string): boolean {
  const [major, minor] = version.split('.').map((part) => parseInt(part, 10))
  if (!Number.isFinite(major)) return true
  if (major !== MIN_NODE_MAJOR) return major > MIN_NODE_MAJOR
  return (Number.isFinite(minor) ? minor : 0) >= MIN_NODE_MINOR
}

export function unsupportedNodeVersionMessage(version: string): string {
  return (
    `[Extension.js] Requires Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} ` +
    `(you are on ${version}). Upgrade Node.js to run the extension CLI.`
  )
}

export function enforceSupportedNodeVersion(
  version: string = process.versions.node
): void {
  if (isSupportedNodeVersion(version)) return
  // eslint-disable-next-line no-console
  console.error(unsupportedNodeVersionMessage(version))
  process.exit(1)
}

// This module must stay dependency-free and be the entry's FIRST import: the
// check runs at load time, before any import can transitively require ESM.
enforceSupportedNodeVersion()
