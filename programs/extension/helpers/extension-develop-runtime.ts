//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {getCliPackageJson} from './cli-package-json'
import * as messages from './messages'
import {CODES} from './messaging'

const require = createRequire(import.meta.url)

// The loosest view of the engine, for the bridge entry and for the loaders a
// spec injects. The build and preview loaders default to the real types.
// biome-ignore lint/suspicious/noExplicitAny: dynamic module loading boundary, callers narrow per import
export type AnyDevelopModule = any

// The engine's own types, so a call into it is checked against what it exports.
export type DevelopModule = typeof import('extension-develop')
export type DevelopPreviewModule = typeof import('extension-develop/preview')

// The part of the engine one call site reads. An engine that predates
// loadCommandConfig is read as having no config.
export type DevelopFor<K extends keyof DevelopModule = never> = Pick<
  DevelopModule,
  K
> &
  Partial<Pick<DevelopModule, 'loadCommandConfig'>>

// The engine is refused at any other version, so its bridge has every export.
export type DevelopBridge = typeof import('extension-develop/bridge')

export type DevelopBrowser = import('extension-develop').BrowserType
export type DevelopLauncher = import('extension-develop').BrowserLauncherFn
export type DevelopPreviewLauncher =
  import('extension-develop/preview').PreviewLauncherFn

function parseJsonSafe(filePath: string): AnyDevelopModule {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

// A broken install, not a fault in the CLI, so the frame names it.
function runtimeNotFound(message: string): Error {
  return Object.assign(new Error(message), {code: CODES.E_RUNTIME_NOT_FOUND})
}

function runtimeNotBuilt(root: string): Error {
  return runtimeNotFound(
    `Local extension-develop runtime is not built at ${path.join(root, 'dist')}. ` +
      'Run `pnpm --filter extension-develop compile` before invoking the local CLI.'
  )
}

function resolveDevelopRootFromDir(dir: string): string | undefined {
  try {
    const packageJsonPath = path.join(dir, 'package.json')
    if (!fs.existsSync(packageJsonPath)) return undefined

    const pkg = parseJsonSafe(packageJsonPath)

    return pkg?.name === 'extension-develop' ? dir : undefined
  } catch {
    return undefined
  }
}

function resolveWorkspaceDevelopRoot(startDir: string): string | undefined {
  let currentDir = path.resolve(startDir)

  // Inside an installed copy (node_modules in the path), don't escape into the
  // surrounding project: an outer monorepo would hijack the resolution.
  if (currentDir.split(path.sep).includes('node_modules')) return undefined

  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(currentDir, 'programs', 'develop')
    const resolved = resolveDevelopRootFromDir(candidate)
    if (resolved) return resolved

    const parent = path.dirname(currentDir)
    if (parent === currentDir) break

    currentDir = parent
  }

  return undefined
}

const BROKEN_MANIFEST = 'ERR_INVALID_PACKAGE_CONFIG'

// Node's own lookup from one folder, or from this file when none is given.
function resolveInstalledDevelopRootFrom(
  startDir: string | undefined
): string | undefined {
  const options = startDir ? {paths: [startDir]} : undefined

  try {
    const packageJsonPath = require.resolve(
      'extension-develop/package.json',
      options
    )

    return resolveDevelopRootFromDir(path.dirname(packageJsonPath))
  } catch {
    const entryPath = require.resolve('extension-develop', options)

    return resolveDevelopRootFromDir(path.dirname(path.dirname(entryPath)))
  }
}

// The engine installed for the CLI at startDir is the one beside it. A start
// folder that reaches no install falls back to this file's own lookup.
function resolveInstalledDevelopRoot(startDir: string): string | undefined {
  for (const from of [startDir, undefined]) {
    try {
      return resolveInstalledDevelopRootFrom(from)
    } catch (error) {
      // An install that is there with a broken manifest is the answer.
      if ((error as {code?: unknown})?.code === BROKEN_MANIFEST) break
    }
  }

  return undefined
}

type DevelopRootSource = 'workspace' | 'env' | 'installed' | 'missing'

const ignoredDevelopRoots = new Set<string>()

function warnDevelopRootIgnored(envRoot: string): void {
  if (ignoredDevelopRoots.has(envRoot)) return

  ignoredDevelopRoots.add(envRoot)
  // eslint-disable-next-line no-console
  console.warn(messages.developRootIgnored(envRoot))
}

function resolvePreferredDevelopRoot(startDir: string): {
  root: string | undefined
  source: DevelopRootSource
} {
  const workspaceRoot = resolveWorkspaceDevelopRoot(startDir)
  if (workspaceRoot) return {root: workspaceRoot, source: 'workspace'}

  const envValue = process.env.EXTENSION_DEVELOP_ROOT
  const envRoot = envValue
    ? resolveDevelopRootFromDir(path.resolve(envValue))
    : undefined
  if (envRoot) return {root: envRoot, source: 'env'}
  if (envValue) warnDevelopRootIgnored(path.resolve(envValue))

  const installedRoot = resolveInstalledDevelopRoot(startDir)
  if (installedRoot) return {root: installedRoot, source: 'installed'}

  return {root: undefined, source: 'missing'}
}

function resolveDevelopDistEntry(
  root: string,
  name: string = 'module'
): string | undefined {
  const base = path.join(root, 'dist', name)
  const candidates = [`${base}.mjs`, `${base}.cjs`, `${base}.js`, base]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

export function resolveExtensionDevelopRoot(
  startDir: string = __dirname
): string {
  const {root, source} = resolvePreferredDevelopRoot(startDir)

  if (!root) {
    throw runtimeNotFound('Unable to locate the extension-develop runtime.')
  }

  process.env.EXTENSION_DEVELOP_ROOT = root

  if (source === 'workspace') {
    process.env.EXTENSION_CREATE_DEVELOP_ROOT = root
  }

  return root
}

export function resolveExtensionDevelopVersion(
  startDir: string = __dirname,
  fallbackVersion?: string
): string {
  try {
    const root = resolveExtensionDevelopRoot(startDir)
    const packageJsonPath = path.join(root, 'package.json')
    const pkg = parseJsonSafe(packageJsonPath)

    return pkg?.version || fallbackVersion || '0.0.0'
  } catch {
    return fallbackVersion || '0.0.0'
  }
}

function realPathOf(dir: string): string {
  try {
    return fs.realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

// The CLI writes the root it found to EXTENSION_DEVELOP_ROOT, so the variable
// alone proves nothing. A local engine is one that is not the CLI's install.
function isLocalDevelopRoot(root: string, startDir: string): boolean {
  const installedRoot = resolveInstalledDevelopRoot(startDir)

  return !installedRoot || realPathOf(installedRoot) !== realPathOf(root)
}

const PROJECT_ADD_COMMANDS: Array<[string, string]> = [
  ['pnpm-lock.yaml', 'pnpm add extension@'],
  ['yarn.lock', 'yarn add extension@'],
  ['bun.lock', 'bun add extension@'],
  ['bun.lockb', 'bun add extension@'],
  ['deno.lock', 'deno add npm:extension@'],
  ['package-lock.json', 'npm install extension@']
]

// The one command that puts both packages back at the CLI's version, read off
// where the engine was installed: a runner cache, a global folder or a project.
export function reinstallCommandFor(engineRoot: string, version: string) {
  const parts = path.resolve(engineRoot).split(path.sep)
  const nodeModules = parts.indexOf('node_modules')
  const above = nodeModules >= 0 ? parts.slice(0, nodeModules) : parts
  const has = (...names: string[]) => names.every((n) => above.includes(n))

  if (above.includes('_npx')) return `npx extension@${version}`
  if (has('pnpm', 'dlx')) return `pnpm dlx extension@${version}`

  if (above.some((part) => part.startsWith('bunx-'))) {
    return `bunx extension@${version}`
  }

  if (has('.bun', 'global')) return `bun add -g extension@${version}`
  if (has('pnpm', 'global')) return `pnpm add -g extension@${version}`
  if (has('yarn', 'global')) return `yarn global add extension@${version}`

  const project = above.join(path.sep) || path.sep

  if (!fs.existsSync(path.join(project, 'package.json'))) {
    return `npm install -g extension@${version}`
  }

  for (const [lockfile, command] of PROJECT_ADD_COMMANDS) {
    if (fs.existsSync(path.join(project, lockfile))) return command + version
  }

  return `npm install extension@${version}`
}

function judgeDevelopVersion(root: string, startDir: string): Error | null {
  let cliVersion: unknown

  try {
    cliVersion = getCliPackageJson().version
  } catch {
    // A CLI that cannot name its own version has nothing to compare.
    return null
  }

  if (typeof cliVersion !== 'string' || !cliVersion) return null

  let engineVersion: string

  try {
    const pkg = parseJsonSafe(path.join(root, 'package.json'))

    engineVersion = typeof pkg?.version === 'string' ? pkg.version : ''
  } catch {
    return runtimeNotFound('Unable to locate the extension-develop runtime.')
  }

  if (engineVersion === cliVersion) return null

  const found = engineVersion || 'unknown'

  if (isLocalDevelopRoot(root, startDir)) {
    // eslint-disable-next-line no-console
    console.warn(messages.localDevelopVersionDiffers(cliVersion, found, root))

    return null
  }

  return runtimeNotFound(
    messages.developVersionMismatch(
      cliVersion,
      found,
      root,
      reinstallCommandFor(root, cliVersion)
    )
  )
}

// One verdict per engine root, so a command that loads several entries reads
// the manifest once and names a local engine once.
const developVersionVerdicts = new Map<string, Error | null>()

// The CLI and the engine are published as one exact version, so any other
// pair is a broken install. Runs before the engine is imported.
export function assertDevelopVersionMatches(
  root: string,
  startDir: string = __dirname
): void {
  let refusal = developVersionVerdicts.get(root)

  if (refusal === undefined) {
    refusal = judgeDevelopVersion(root, startDir)
    developVersionVerdicts.set(root, refusal)
  }

  if (refusal) throw refusal
}

// The engine of the checkout the CLI runs from is its own by construction.
function assertLoadableDevelopRoot(
  root: string,
  source: DevelopRootSource,
  startDir: string
): void {
  if (source !== 'workspace') assertDevelopVersionMatches(root, startDir)
}

async function importModule<T = AnyDevelopModule>(
  filePath: string
): Promise<T> {
  const mod: AnyDevelopModule = await import(pathToFileURL(filePath).href)

  return (
    mod?.default && typeof mod.default === 'object'
      ? {...mod.default, ...mod}
      : mod
  ) as T
}

export async function loadExtensionDevelopModule<T = DevelopModule>(
  startDir: string = __dirname
): Promise<T> {
  const root = resolveExtensionDevelopRoot(startDir)
  const {source} = resolvePreferredDevelopRoot(startDir)

  assertLoadableDevelopRoot(root, source, startDir)
  const distEntry = resolveDevelopDistEntry(root)

  if (distEntry) {
    return importModule<T>(distEntry)
  }

  if (source === 'workspace') {
    throw runtimeNotBuilt(root)
  }

  return (await import('extension-develop')) as T
}

// Load only the lightweight preview entry, avoiding rspack and the full build
// toolchain, so extension preview starts significantly faster.
export async function loadExtensionDevelopPreviewModule<
  T = DevelopPreviewModule
>(startDir: string = __dirname): Promise<T> {
  const root = resolveExtensionDevelopRoot(startDir)
  const {source} = resolvePreferredDevelopRoot(startDir)

  assertLoadableDevelopRoot(root, source, startDir)
  const previewEntry = resolveDevelopDistEntry(root, 'preview')

  if (previewEntry) {
    return importModule<T>(previewEntry)
  }

  // Fall back to the full module if the preview entry doesn't exist
  // (e.g. older extension-develop versions without the split entry).
  const fullEntry = resolveDevelopDistEntry(root)

  if (fullEntry) {
    return importModule<T>(fullEntry)
  }

  if (source === 'workspace') {
    throw runtimeNotBuilt(root)
  }

  return (await import('extension-develop/preview')) as T
}

// Load only the lightweight agent-bridge entry for extension logs;
// avoids pulling in rspack like preview does.
export async function loadExtensionDevelopBridgeModule<T = DevelopBridge>(
  startDir: string = __dirname
): Promise<T> {
  const root = resolveExtensionDevelopRoot(startDir)
  const {source} = resolvePreferredDevelopRoot(startDir)

  assertLoadableDevelopRoot(root, source, startDir)
  const bridgeEntry = resolveDevelopDistEntry(root, 'bridge')

  if (bridgeEntry) {
    return importModule<T>(bridgeEntry)
  }

  if (source === 'workspace') {
    throw runtimeNotBuilt(root)
  }

  // Non-literal specifier: resolved at runtime via the workspace symlink /
  // installed package. Published type defs may predate this subpath.
  const bridgeSpecifier: string = 'extension-develop/bridge'

  return (await import(bridgeSpecifier)) as T
}
