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

// Bun sets process.versions.bun and Node never does, so this is the one signal
// that holds under `bunx --bun`, `bun run --bun` and a bunfig `run.bun` default.
export function detectBunVersion(
  versions: NodeJS.ProcessVersions = process.versions
): string | undefined {
  const bunVersion = versions.bun
  return typeof bunVersion === 'string' && bunVersion.length > 0
    ? bunVersion
    : undefined
}

// Under the Bun runtime the reported Node version is Bun's emulated one, so
// naming the user's Node install would send them to upgrade the wrong thing.
export function unsupportedNodeVersionMessage(
  version: string,
  bunVersion?: string
): string {
  if (bunVersion) {
    return (
      `[Extension.js] The extension CLI runs on Node.js, not on the Bun ` +
      `runtime. Bun ${bunVersion} emulates Node.js ${version}, below the ` +
      `required ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}, so the Node.js you have ` +
      `installed is not the problem. Re-run without the --bun flag, plain ` +
      `bunx runs the extension CLI on Node.js.`
    )
  }

  return (
    `[Extension.js] Requires Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} ` +
    `(you are on ${version}). Upgrade Node.js to run the extension CLI.`
  )
}

export function enforceSupportedNodeVersion(
  version: string = process.versions.node,
  bunVersion: string | undefined = detectBunVersion()
): void {
  if (isSupportedNodeVersion(version)) return
  // eslint-disable-next-line no-console
  console.error(unsupportedNodeVersionMessage(version, bunVersion))
  process.exit(1)
}

// This module must stay dependency-free and be the entry's FIRST import: the
// check runs at load time, before any import can transitively require ESM.
enforceSupportedNodeVersion()
