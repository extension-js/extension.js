//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'

const MIN_NODE_MAJOR = 22
const MIN_NODE_MINOR = 12

// Deno 2.5 is the oldest release that both clears the Node floor it emulates and
// compiles a project here. Every release before it reports Node 20 and stops.
const MIN_DENO_MAJOR = 2
const MIN_DENO_MINOR = 5

// Bun 1.2 is the oldest release that loads the rspack native binding and runs a
// dev session. 1.1.38 reaches the binding and then dies inside napi.
const MIN_BUN_MAJOR = 1
const MIN_BUN_MINOR = 2

// Deno 2.8.0 alone cannot resolve node:querystring from inside the bundler, so a
// build dies on a scheme error it never explains. Deno fixed that in 2.8.1.
const BLOCKED_DENO_VERSIONS = ['2.8.0']

function meetsFloor(version: string, major: number, minor: number): boolean {
  const [actualMajor, actualMinor] = version
    .split('.')
    .map((part) => parseInt(part, 10))
  if (!Number.isFinite(actualMajor)) return true
  if (actualMajor !== major) return actualMajor > major

  return (Number.isFinite(actualMinor) ? actualMinor : 0) >= minor
}

export function isSupportedNodeVersion(version: string): boolean {
  return meetsFloor(version, MIN_NODE_MAJOR, MIN_NODE_MINOR)
}

export function isSupportedDenoVersion(version: string): boolean {
  if (BLOCKED_DENO_VERSIONS.includes(version)) return false

  return meetsFloor(version, MIN_DENO_MAJOR, MIN_DENO_MINOR)
}

export function isSupportedBunVersion(version: string): boolean {
  return meetsFloor(version, MIN_BUN_MAJOR, MIN_BUN_MINOR)
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

// Deno sets process.versions.deno, and the Node version beside it is emulated,
// so the Deno number is the only one a user on Deno can act on.
export function detectDenoVersion(
  versions: NodeJS.ProcessVersions = process.versions
): string | undefined {
  const denoVersion = (versions as {deno?: string}).deno

  return typeof denoVersion === 'string' && denoVersion.length > 0
    ? denoVersion
    : undefined
}

export function unsupportedDenoVersionMessage(version: string): string {
  if (BLOCKED_DENO_VERSIONS.includes(version)) {
    return (
      `[Extension.js] Deno ${version} cannot load node:querystring inside the ` +
      `bundler, so every build fails on it. Deno fixed that in 2.8.1. Run ` +
      `deno upgrade to build the extension on Deno.`
    )
  }

  return (
    `[Extension.js] Requires Deno >= ${MIN_DENO_MAJOR}.${MIN_DENO_MINOR} ` +
    `(you are on ${version}). Run deno upgrade, or run the extension CLI on ` +
    `Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} instead.`
  )
}

// Bun below 1.2 fails inside the rspack native binding, which reads as a broken
// install rather than an old runtime, so the message names Bun and not Node.
export function unsupportedBunVersionMessage(version: string): string {
  return (
    `[Extension.js] Requires Bun >= ${MIN_BUN_MAJOR}.${MIN_BUN_MINOR} ` +
    `(you are on ${version}). Run bun upgrade, or run the extension CLI on ` +
    `Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} instead.`
  )
}

export function unsupportedNodeVersionMessage(version: string): string {
  return (
    `[Extension.js] Requires Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} ` +
    `(you are on ${version}). Upgrade Node.js to run the extension CLI.`
  )
}

function wantsJsonOutput(argv: string[]): boolean {
  const inline = argv.find((arg) => arg.startsWith('--output='))
  const index = argv.indexOf('--output')
  const spaced = index >= 0 ? argv[index + 1] : undefined
  const value = inline ? inline.slice('--output='.length) : spaced

  return (
    String(value || '')
      .trim()
      .toLowerCase() === 'json'
  )
}

function commandFromArgv(argv: string[]): string {
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--output') index += 1
    else if (!argv[index].startsWith('-')) return argv[index]
  }

  return 'extension'
}

// Built by hand because nothing may be imported before this check runs. The
// shape is the schema-1 failure envelope every other early refusal writes.
export function unsupportedNodeVersionFrame(
  version: string,
  argv: string[]
): Record<string, unknown> | undefined {
  if (!wantsJsonOutput(argv)) return undefined

  return {
    schema: 1,
    ok: false,
    command: commandFromArgv(argv),
    status: 'usage',
    value: null,
    error: {
      code: 'E_NODE_VERSION',
      message: unsupportedNodeVersionMessage(version).replace(
        '[Extension.js] ',
        ''
      ),
      name: 'CliError'
    },
    warnings: []
  }
}

function writeFrame(frame: Record<string, unknown>): void {
  try {
    fs.writeSync(1, `${JSON.stringify(frame)}\n`)
  } catch {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(frame))
  }
}

// Each runtime is judged on its own version. Bun and Deno both report an
// emulated Node number that does not track their real capability: Bun 1.1.38
// and Bun 1.2.0 both say Node 22.6.0, and only one of them works.
export function enforceSupportedNodeVersion(
  version: string = process.versions.node,
  bunVersion: string | undefined = detectBunVersion(),
  denoVersion: string | undefined = detectDenoVersion(),
  argv: string[] = process.argv
): void {
  if (denoVersion) {
    if (isSupportedDenoVersion(denoVersion)) return

    // eslint-disable-next-line no-console
    console.error(unsupportedDenoVersionMessage(denoVersion))
    process.exit(1)

    return
  }

  if (bunVersion) {
    if (isSupportedBunVersion(bunVersion)) return

    // eslint-disable-next-line no-console
    console.error(unsupportedBunVersionMessage(bunVersion))
    process.exit(1)

    return
  }

  if (isSupportedNodeVersion(version)) return

  // eslint-disable-next-line no-console
  console.error(unsupportedNodeVersionMessage(version))

  const frame = unsupportedNodeVersionFrame(version, argv)
  if (frame) writeFrame(frame)

  process.exit(1)
}

// This module must stay dependency-free and be the entry's FIRST import: the
// check runs at load time, before any import can transitively require ESM.
enforceSupportedNodeVersion()
