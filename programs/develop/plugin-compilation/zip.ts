//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {type Zippable, zipSync} from 'fflate'
import ignore from 'ignore'
import glob from 'tiny-glob'
import {resolveLocalizedManifestName} from '../lib/localized-manifest-name'
import * as messages from '../lib/messages'
import {debugLine, isDebug} from '../lib/messaging'
import {parseJsonSafe} from '../lib/parse-json-safe'
import {isKnownBrowserName} from '../lib/paths'
import {REMOTE_SOURCE_PROVENANCE_FILE} from '../lib/zip'
import type {DevOptions} from '../types'
import * as compilationMessages from './compilation-lib/messages'
import {recordZipArtifact, recordZipFailure} from './zip-artifacts'
import {dropEdgeStoreKey} from './zip-edge-key'

export interface ZipPluginOptions {
  manifestPath?: string
  browser: DevOptions['browser']
  zipData?: {
    zip?: boolean
    zipSource?: boolean
    zipFilename?: string
    // Absolute folder for the archives, the build output's parent when unset.
    zipDir?: string
  }
}

// Letters NFKD does not split into a base letter plus a mark
const LATIN_LIGATURES: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th'
}

// Transliterates before stripping, so "análise" keeps its letters as "analise"
export function sanitize(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ßæœøłđðþ]/g, (letter) => LATIN_LIGATURES[letter])
    .replace(/[^a-z0-9 ]/gi, '')
    .trim()
    .replace(/\s+/g, '-')

  return slug || 'extension'
}

// An explicit --zip-filename keeps its dashes and case: only path separators,
// reserved characters and trailing dots are stripped.
function explicitZipFilename(input: string): string {
  const flat = path.basename(input.trim())
  const safe = flat
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\.+$/, '')
    .trim()
  if (!safe) return 'extension.zip'

  return /\.zip$/i.test(safe) ? safe : `${safe}.zip`
}

// Every archive name carries its browser, so two browsers built with one
// explicit name in separate runs never write over each other.
function withBrowserSuffix(zipName: string, browser: string): string {
  const stem = zipName.replace(/\.zip$/i, '')
  const suffix = `-${browser}`

  if (stem.toLowerCase().endsWith(suffix.toLowerCase())) return `${stem}.zip`

  return `${stem}${suffix}.zip`
}

const toPosix = (p: string): string => p.replace(/\\/g, '/')

// The first instant a zip can record, in local fields as the format stores
// them, so the bytes are the same in every time zone.
const REBUILT_ENTRY_TIME = new Date(1980, 0, 1, 0, 0, 0)

// One zip entry per real file. A source file keeps its own mode and mtime.
// A built file would record the build's clock and umask, so it gets neither.
function zipEntryFor(absPath: string, rebuilt: boolean): Zippable[string] {
  const stat = fs.statSync(absPath)
  const mode = rebuilt
    ? stat.mode & 0o111
      ? 0o755
      : 0o644
    : stat.mode & 0o7777

  return [
    new Uint8Array(fs.readFileSync(absPath)),
    {
      mtime: rebuilt ? REBUILT_ENTRY_TIME : stat.mtime,
      os: 3,
      attrs: ((mode | 0o100000) << 16) >>> 0
    }
  ]
}

function writeZipFile(
  zipPath: string,
  entries: Array<{name: string; absPath: string; content?: Uint8Array}>,
  rebuilt = false
): void {
  const zippable: Zippable = {}

  for (const entry of entries) {
    const file = zipEntryFor(entry.absPath, rebuilt)

    if (entry.content) file[0] = entry.content

    zippable[toPosix(entry.name)] = file
  }

  fs.mkdirSync(path.dirname(zipPath), {recursive: true})
  fs.writeFileSync(zipPath, zipSync(zippable))
}

function listFilesUnder(root: string, skipNames: Set<string>): string[] {
  const out: string[] = []
  const stack: string[] = ['']

  while (stack.length) {
    const relDir = stack.pop() as string
    const absDir = path.join(root, relDir)
    let entries: fs.Dirent[] = []

    try {
      entries = fs.readdirSync(absDir, {withFileTypes: true})
    } catch {
      continue
    }

    for (const entry of entries) {
      const rel = relDir ? path.join(relDir, entry.name) : entry.name

      if (entry.isDirectory()) {
        stack.push(rel)
      } else if (entry.isFile() && !skipNames.has(toPosix(rel))) {
        out.push(rel)
      }
    }
  }

  return inArchiveOrder(out)
}

// Ordered by the name the archive stores. Sorting the platform's own
// spelling put a folder after its dotted and dashed siblings on Windows.
export function inArchiveOrder(files: string[]): string[] {
  const named = files.map((file) => ({file, name: toPosix(file)}))

  named.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  return named.map(({file}) => file)
}

// Companion extensions under ./extensions are loaded beside yours for local
// debugging and are somebody else's code, so they are never part of your
// source. Relying on .gitignore to keep them out is not enough: the ignore
// file is written by whatever placed the companion, it is absent in a project
// that is not a repository, and a source zip is published. A companion that
// carries broad host permissions would otherwise ship inside a release
// someone downloads and trusts.
const COMPANION_DIR = 'extensions'

function isCompanionExtension(file: string): boolean {
  const [first] = toPosix(file).split('/')

  return first === COMPANION_DIR
}

// The source zip is the artifact the share feature hands to strangers, so
// exclusion cannot depend on the user having written a correct .gitignore.
// This deny list is the security boundary; the root .gitignore is only a
// courtesy supplement on top of it. `.git` also matches the worktree case
// where `.git` is a file, and matching any path segment covers nested
// repositories and nested node_modules too. The two stamps are files the
// tooling wrote about a tree, not the author's source, so neither is published.
const DENIED_SEGMENTS = new Set([
  '.git',
  '.extension-js',
  'node_modules',
  '.extension-create.json',
  REMOTE_SOURCE_PROVENANCE_FILE
])

// dist holds the compiled build, the archives of earlier runs and, under
// dist/extension-js, managed browser profiles (cookies, logins) and session
// logs. None of it is source, and its self-ignore is invisible to a root scan.
const DEFAULT_OUTPUT_DIR = 'dist'

// Env files hold the secrets the framework itself tells users to put there
// (config-loader and EnvPlugin load .env, .env.development, .env.local).
// Only the shareable *.example variants may ship.
function isDeniedEnvFile(basename: string): boolean {
  if (!basename.startsWith('.env')) return false

  return !basename.endsWith('.example')
}

// Staging dirs exist while the zip hook runs (the promote happens after the
// done hooks), so they must be denied by name or they leak into the zip.
const STAGING_DIR_PREFIX = '.extension-build-'

// Names are compared in lower case: Windows and macOS open KEY.PEM as key.pem.
function lowerBasename(file: string): string {
  const posix = toPosix(file)

  return posix.slice(posix.lastIndexOf('/') + 1).toLowerCase()
}

// What an operating system writes into any folder it shows. Nobody misses it.
const OS_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])

// Folders a tool keeps for one machine. A project commits .vscode and .idea
// on purpose, so those two are packed.
const MACHINE_LOCAL_DIRS = new Set(['.claude', '.vercel'])

export function isDeniedFromSourceZip(file: string): boolean {
  const posix = toPosix(file)
  const segments = posix.split('/')
  if (segments.some((segment) => DENIED_SEGMENTS.has(segment))) return true

  if (segments.some((segment) => segment.startsWith(STAGING_DIR_PREFIX))) {
    return true
  }

  if (segments.some((name) => MACHINE_LOCAL_DIRS.has(name.toLowerCase()))) {
    return true
  }

  const basename = lowerBasename(posix)

  if (isDeniedEnvFile(basename) || OS_FILES.has(basename)) return true

  return isUnder(posix, DEFAULT_OUTPUT_DIR)
}

export type LeftOutReason = 'key' | 'registry' | 'archive' | 'build' | 'env'

export interface LeftOut {
  reason: LeftOutReason
  path: string
}

// Containers of a private key by format or by fixed name. Public material a
// build may need (.pub, .crt, .cer) is packed.
const KEY_EXTENSIONS = [
  '.pem',
  '.crx',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.ppk'
]
const KEY_BASENAMES = new Set(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'])

function isKeyFileName(basename: string): boolean {
  return (
    KEY_BASENAMES.has(basename) ||
    KEY_EXTENSIONS.some((extension) => basename.endsWith(extension))
  )
}

// The two names this plugin writes: <name>-source.zip, and a name that ends
// in a version and a browser. Any other zip can be a fixture or an asset.
export function isOwnArchiveName(file: string): boolean {
  const basename = lowerBasename(file)

  if (!basename.endsWith('.zip')) return false

  if (basename.endsWith('-source.zip')) return true

  const parts = basename.slice(0, -'.zip'.length).split('-')

  // A browser name holds at most one dash, as in chromium-based.
  return [1, 2].some((taken) => {
    const version = parts[parts.length - taken - 1]

    return (
      parts.length > taken + 1 &&
      /^\d[\w.+]*$/.test(version) &&
      isKnownBrowserName(parts.slice(-taken).join('-'))
    )
  })
}

const BUILD_DIR_NAMES = new Set(['dist', 'build'])

// A build writes <dist or build>/<browser>/manifest.json. Only that browser
// folder is named, so whatever else the parent holds is still packed.
export function findNestedBuildFolders(files: string[]): string[] {
  const folders = new Set<string>()

  for (const file of files) {
    const segments = toPosix(file).split('/')
    const [parent, browser, basename] = segments
      .slice(-3)
      .map((segment) => segment.toLowerCase())

    if (
      segments.length >= 3 &&
      basename === 'manifest.json' &&
      isKnownBrowserName(browser) &&
      BUILD_DIR_NAMES.has(parent)
    ) {
      folders.add(segments.slice(0, -1).join('/'))
    }
  }

  return inArchiveOrder([...folders])
}

// The folder web-ext writes its archives into.
const WEB_EXT_ARTIFACTS_DIR = 'web-ext-artifacts'

export function leftOutOfSourceByName(
  listed: string,
  buildFolders: string[]
): LeftOut | undefined {
  const file = toPosix(listed)
  const segments = file.split('/')

  if (isKeyFileName(lowerBasename(file))) return {reason: 'key', path: file}

  const artifacts = segments.findIndex(
    (segment, index) =>
      index < segments.length - 1 &&
      segment.toLowerCase() === WEB_EXT_ARTIFACTS_DIR
  )

  if (artifacts !== -1) {
    return {
      reason: 'archive',
      path: segments.slice(0, artifacts + 1).join('/')
    }
  }

  if (isOwnArchiveName(file)) return {reason: 'archive', path: file}

  const buildFolder = buildFolders.find((folder) => isUnder(file, folder))

  return buildFolder ? {reason: 'build', path: buildFolder} : undefined
}

const REGISTRY_FILES = new Set(['.npmrc', '.yarnrc', '.yarnrc.yml'])
const AUTH_ENTRY =
  /(?:^|[^A-Za-z0-9])(?:_authToken|_auth|_password|npmAuthToken|npmAuthIdent)["']?\s*(?:=|:|\s)\s*(.*)$/
const ENV_REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*(?::?-|\?)?\}/g

// True when an auth entry carries a value of its own. A value that only
// reads the environment, as in ${NPM_TOKEN}, holds nothing to keep back.
export function holdsRegistrySecret(text: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const entry = line.trim()

    if (entry.startsWith('#') || entry.startsWith(';')) return false

    const match = AUTH_ENTRY.exec(entry)

    if (!match) return false

    const value = match[1]
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2')

    return !/^:?$/.test(value.replace(ENV_REFERENCE, '').trim())
  })
}

const PRIVATE_KEY_HEADER = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/

// Read only for the few names whose text decides: a registry file, and a
// .key file, which is a private key for some tools and a slide deck for others.
function leftOutOfSourceByText(
  projectDir: string,
  file: string
): LeftOut | undefined {
  const basename = lowerBasename(file)
  const isRegistryFile = REGISTRY_FILES.has(basename)

  if (!isRegistryFile && !basename.endsWith('.key')) return undefined

  let text = ''

  try {
    text = fs.readFileSync(path.join(projectDir, file), 'latin1')
  } catch {
    return undefined
  }

  if (isRegistryFile) {
    return holdsRegistrySecret(text)
      ? {reason: 'registry', path: file}
      : undefined
  }

  return PRIVATE_KEY_HEADER.test(text) ? {reason: 'key', path: file} : undefined
}

function addLeftOut(list: LeftOut[], entry: LeftOut): void {
  const known = list.some(
    (other) => other.reason === entry.reason && other.path === entry.path
  )

  if (!known) list.push(entry)
}

function isUnder(file: string, root: string | undefined): boolean {
  if (!root) return false

  return file === root || file.startsWith(`${root}/`)
}

// A build writes its session folder beside the browser folder of whatever
// output it used, so one can sit anywhere a build once ran.
const SESSION_DIR = 'extension-js'
const SESSION_SUBDIRS = new Set(['profiles', 'binaries'])
const SESSION_FILES = new Set([
  'ready.json',
  'events.ndjson',
  'logs.ndjson',
  'actions.ndjson',
  'build-summary.json',
  'control-port'
])

interface SessionDirFacts {
  ownPackage: boolean
  sessionFiles: boolean
}

function sessionDirFacts(files: string[]): Map<string, SessionDirFacts> {
  const facts = new Map<string, SessionDirFacts>()

  for (const file of files) {
    const segments = toPosix(file).split('/')

    for (let index = 0; index < segments.length - 1; index++) {
      if (segments[index] !== SESSION_DIR) continue

      const dir = segments.slice(0, index + 1).join('/')
      const rest = segments.slice(index + 1)
      const known = facts.get(dir) || {ownPackage: false, sessionFiles: false}

      if (rest.length === 1 && rest[0] === 'package.json') {
        known.ownPackage = true
      }

      if (
        (rest.length > 1 && SESSION_SUBDIRS.has(rest[0])) ||
        (rest.length === 2 && SESSION_FILES.has(rest[1]))
      ) {
        known.sessionFiles = true
      }

      facts.set(dir, known)
    }
  }

  return facts
}

// In source the name alone decides, unless the folder is a package of its
// own. In build output only session files do, so a same-named asset ships.
export function findSessionFolders(
  files: string[],
  within: 'source' | 'output'
): string[] {
  const folders = new Set<string>()

  for (const [dir, known] of sessionDirFacts(files)) {
    const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
    const parentName = parent.slice(parent.lastIndexOf('/') + 1)
    // A dist that holds the folder is a build: the whole of it goes.
    const insideDist = within === 'source' && parentName === DEFAULT_OUTPUT_DIR
    const isSession =
      known.sessionFiles ||
      insideDist ||
      (within === 'source' && !known.ownPackage)

    if (isSession) folders.add(insideDist ? parent : dir)
  }

  const sorted = inArchiveOrder([...folders])

  return sorted.filter(
    (folder) =>
      !sorted.some((other) => other !== folder && isUnder(folder, other))
  )
}

function isUnderAny(file: string, folders: string[]): boolean {
  const posix = toPosix(file)

  return folders.some((folder) => isUnder(posix, folder))
}

function relativeWithin(
  projectDir: string,
  target: string
): string | undefined {
  const relative = toPosix(path.relative(projectDir, target))
  const outside =
    relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)

  return outside ? undefined : relative
}

export interface BuildOutput {
  outPath: string
  archives: string[]
  // Where a project sends its archives, when not beside the build output.
  archiveDir?: string
}

// A user config may point the output anywhere in the project. The previous
// run's build and the archives beside it are never source either.
export function isBuildOutput(
  file: string,
  projectDir: string,
  output: BuildOutput
): boolean {
  const posix = toPosix(file)

  if (isUnder(posix, relativeWithin(projectDir, output.outPath))) return true

  const sessionDir = path.join(path.dirname(output.outPath), SESSION_DIR)

  if (isUnder(posix, relativeWithin(projectDir, sessionDir))) return true

  const fileDir = posix.includes('/')
    ? posix.slice(0, posix.lastIndexOf('/'))
    : ''
  const artifactDirs = [path.dirname(output.outPath), output.archiveDir]
    .filter((dir): dir is string => typeof dir === 'string')
    .map((dir) => relativeWithin(projectDir, dir))

  if (/\.zip$/i.test(posix) && artifactDirs.includes(fileDir)) return true

  return output.archives.some(
    (archive) => relativeWithin(projectDir, archive) === posix
  )
}

// A folder the tooling fills with a browser profile ignores itself with a
// file of its own, which a reading of the root file alone never sees.
function nestedIgnoreRules(
  projectDir: string,
  files: string[]
): Array<{dir: string; rules: ReturnType<typeof ignore>}> {
  const nested: Array<{dir: string; rules: ReturnType<typeof ignore>}> = []

  for (const file of files) {
    if (!file.endsWith('/.gitignore') || isDeniedFromSourceZip(file)) continue

    try {
      const content = fs.readFileSync(path.join(projectDir, file), 'utf8')
      const dir = file.slice(0, -'/.gitignore'.length)

      nested.push({dir, rules: ignore().add(content)})
    } catch {
      // Ignore: an unreadable file adds no exclusions of its own.
    }
  }

  return nested
}

function isIgnoredByNestedRules(
  file: string,
  nested: Array<{dir: string; rules: ReturnType<typeof ignore>}>
): boolean {
  return nested.some(
    ({dir, rules}) =>
      file.startsWith(`${dir}/`) && rules.ignores(file.slice(dir.length + 1))
  )
}

export async function getFilesToZip(
  projectDir: string,
  output?: BuildOutput
): Promise<{
  files: string[]
  skippedLinks: string[]
  skippedFolders: string[]
  leftOut: LeftOut[]
}> {
  const gitignorePath = path.join(projectDir, '.gitignore')
  const ig = ignore()

  try {
    const content = fs.readFileSync(gitignorePath, 'utf8')
    if (content) ig.add(content)
  } catch {
    // Ignore: the deny list stays the boundary, a project without a
    // readable .gitignore only loses its own extra exclusions.
  }

  // filesOnly drops directory entries (they only added noise to the zip)
  // and flush bypasses tiny-glob's module-global cache,
  // which would go stale in a long-lived watch process.
  // tiny-glob emits native separators and the ignore package only reads
  // POSIX paths, so a nested gitignored file on Windows would ship otherwise.
  const files = (
    await glob('**/*', {
      cwd: projectDir,
      dot: true,
      filesOnly: true,
      flush: true
    })
  ).map(toPosix)

  const nested = nestedIgnoreRules(projectDir, files)
  const candidates = files.filter(
    (file) =>
      !isDeniedFromSourceZip(file) &&
      !(output && isBuildOutput(file, projectDir, output)) &&
      !ig.ignores(file) &&
      !isIgnoredByNestedRules(file, nested) &&
      !isCompanionExtension(file)
  )
  // Read from the whole listing, so an ignore rule cannot hide the files
  // that tell a session folder apart. Only folders that lost a file are named.
  const skippedFolders = findSessionFolders(files, 'source').filter((folder) =>
    candidates.some((file) => isUnder(file, folder))
  )
  const kept = candidates.filter((file) => !isUnderAny(file, skippedFolders))
  const buildFolders = findNestedBuildFolders(files)
  // tiny-glob lists a symlink as a regular file and does not descend into it,
  // so reading one threw EISDIR or ENOENT and took the whole archive down.
  const regularFiles: string[] = []
  const skippedLinks: string[] = []
  // Named only for a file that would have been packed, so the warning lists
  // what this run removed and nothing an ignore rule already covered.
  const leftOut: LeftOut[] = []

  for (const file of kept) {
    const byName = leftOutOfSourceByName(file, buildFolders)

    if (byName) {
      addLeftOut(leftOut, byName)
      continue
    }

    if (!isRegularFile(path.join(projectDir, file))) {
      skippedLinks.push(file)
      continue
    }

    const byText = leftOutOfSourceByText(projectDir, file)

    if (byText) addLeftOut(leftOut, byText)
    else regularFiles.push(file)
  }

  return {files: regularFiles, skippedLinks, skippedFolders, leftOut}
}

function isRegularFile(absPath: string): boolean {
  try {
    return fs.lstatSync(absPath).isFile()
  } catch {
    return false
  }
}

type ManifestLike = {
  name?: unknown
  version?: unknown
  default_locale?: unknown
}

function readManifest(manifestPath: string): ManifestLike {
  return parseJsonSafe(fs.readFileSync(manifestPath, 'utf-8')) as ManifestLike
}

// A missing default-locale folder makes the zip store-rejectable; warn up
// front so the root cause is visible before upload.
function warnOnMissingDefaultLocale(
  stats: {compilation?: {warnings?: unknown[]}} | undefined,
  manifest: ManifestLike,
  localeRoot: string
): void {
  if (!manifest.default_locale) return

  const messagesPath = path.join(
    localeRoot,
    '_locales',
    String(manifest.default_locale),
    'messages.json'
  )

  if (fs.existsSync(messagesPath)) return

  stats?.compilation?.warnings?.push(
    new Error(
      compilationMessages.zipMissingDefaultLocale(
        String(manifest.default_locale),
        messagesPath
      )
    )
  )
}

export class ZipPlugin {
  private readonly browser: DevOptions['browser']
  private readonly zipData: {
    zip?: boolean
    zipSource?: boolean
    zipFilename?: string
    zipDir?: string
  }

  constructor(private readonly options: ZipPluginOptions) {
    this.browser = this.options.browser || 'chrome'
    this.zipData = this.options.zipData ?? {}
  }

  apply(compiler: Compiler) {
    compiler.hooks.done.tapPromise('plugin-zip', async (stats) => {
      if (!(this.zipData.zip || this.zipData.zipSource)) return

      try {
        const created: Array<{kind: 'source' | 'dist'; path: string}> = []
        const outPath = compiler.options.output?.path as string
        const packageJsonDir = compiler.options.context as string
        const sourceManifestPath =
          this.options.manifestPath ||
          path.join(packageJsonDir, 'manifest.json')
        const distManifestPath = path.join(outPath, 'manifest.json')

        // The emitted manifest is the one the pipeline finished: vendor
        // prefixes resolved, env placeholders filled, version coerced.
        const distManifest =
          this.zipData.zip || fs.existsSync(distManifestPath)
            ? readManifest(distManifestPath)
            : undefined
        const sourceManifest = this.zipData.zipSource
          ? readManifest(sourceManifestPath)
          : undefined

        if (sourceManifest) {
          warnOnMissingDefaultLocale(stats, sourceManifest, packageJsonDir)
        }

        if (distManifest && this.zipData.zip) {
          warnOnMissingDefaultLocale(stats, distManifest, outPath)
        }

        const manifest = distManifest || sourceManifest || {}
        // The zip carries the localized name, and the folder name stands in
        // when no messages file resolves it.
        const base = sanitize(
          resolveLocalizedManifestName(
            manifest,
            [outPath, path.dirname(sourceManifestPath), packageJsonDir],
            {whenUnresolved: path.basename(packageJsonDir)}
          ) || path.basename(packageJsonDir)
        )
        const name = `${base}-${manifest.version || '0.0.0'}`
        const explicitName = this.zipData.zipFilename
          ? explicitZipFilename(this.zipData.zipFilename)
          : undefined
        const zipName = explicitName
          ? withBrowserSuffix(explicitName, String(this.browser))
          : `${name}-${this.browser}.zip`
        // An explicit name governs both archives. The source is the same for
        // every browser, so its name carries none, as the default name does.
        const sourceName = explicitName
          ? explicitName.replace(/\.zip$/i, '-source.zip')
          : `${name}-source.zip`
        // Beside the browser folder, never inside it: dist/<browser> is
        // what a store upload or a load-unpacked takes whole, and a zip
        // left inside it ships in the next package of itself.
        const archiveDir = this.zipData.zipDir || path.dirname(outPath)
        const sourcePath = path.join(archiveDir, sourceName)
        const distPath = path.join(archiveDir, zipName)

        // One archive's failure is not the other's: the source zip used to
        // take the dist zip down with it, and neither was reported as missing.
        if (this.zipData.zipSource) {
          try {
            const {files, skippedLinks, skippedFolders, leftOut} =
              await getFilesToZip(packageJsonDir, {
                outPath,
                archives: [sourcePath, distPath],
                archiveDir: this.zipData.zipDir
              })

            if (leftOut.length) {
              stats?.compilation?.warnings?.push(
                new Error(compilationMessages.zipLeftOut('source', leftOut))
              )
            }

            if (skippedFolders.length) {
              stats?.compilation?.warnings?.push(
                new Error(
                  compilationMessages.zipLeftOutSessionFolders(
                    'source',
                    skippedFolders
                  )
                )
              )
            }

            if (skippedLinks.length) {
              stats?.compilation?.warnings?.push(
                new Error(messages.zipSkippedSymlinks(skippedLinks))
              )
            }

            if (isDebug()) {
              debugLine(messages.packagingSourceFiles(sourcePath))
            }

            writeZipFile(
              sourcePath,
              files.map((file) => ({
                name: file,
                absPath: path.join(packageJsonDir, file)
              }))
            )

            created.push({kind: 'source', path: sourcePath})
          } catch (error) {
            recordZipFailure(stats?.compilation, {
              kind: 'source',
              path: sourcePath,
              reason: String((error as Error)?.message || error)
            })
          }
        }

        if (this.zipData.zip) {
          try {
            if (isDebug()) {
              debugLine(messages.packagingDistributionFiles(distPath))
            }

            const edgeKey = distManifest
              ? dropEdgeStoreKey(distManifest, this.browser)
              : {manifest: undefined, dropped: false}

            // An output a config points at dist itself, or at the project,
            // has the session folder inside it and not beside it.
            const built = listFilesUnder(outPath, new Set([toPosix(zipName)]))
            const sessionFolders = findSessionFolders(built, 'output')

            if (sessionFolders.length) {
              stats?.compilation?.warnings?.push(
                new Error(
                  compilationMessages.zipLeftOutSessionFolders(
                    'dist',
                    sessionFolders
                  )
                )
              )
            }

            writeZipFile(
              distPath,
              // A store zip carries the extension, not its debugging aids: a
              // development-mode build leaves maps in dist for the author.
              built
                .filter((file) => !isUnderAny(file, sessionFolders))
                .filter((file) => !file.endsWith('.map'))
                .map((file) => ({
                  name: file,
                  absPath: path.join(outPath, file),
                  content:
                    edgeKey.dropped && toPosix(file) === 'manifest.json'
                      ? new TextEncoder().encode(
                          `${JSON.stringify(edgeKey.manifest, null, 2)}\n`
                        )
                      : undefined
                })),
              true
            )

            if (edgeKey.dropped) {
              stats?.compilation?.warnings?.push(
                new Error(messages.zipEdgeKeyDropped(distPath))
              )
            }

            created.push({kind: 'dist', path: distPath})
          } catch (error) {
            recordZipFailure(stats?.compilation, {
              kind: 'dist',
              path: distPath,
              reason: String((error as Error)?.message || error)
            })
          }
        }

        for (const artifact of created) {
          let size = 0

          try {
            size = fs.statSync(artifact.path).size
          } catch {
            // Ignore
          }

          recordZipArtifact(stats?.compilation, {
            kind: artifact.kind,
            path: artifact.path,
            size
          })
        }

        if (isDebug()) {
          const sourceItem = created.find((c) => c.kind === 'source')
          const distItem = created.find((c) => c.kind === 'dist')

          if (sourceItem && distItem) {
            debugLine(
              messages.treeWithSourceAndDistFiles(
                this.browser,
                name,
                sourceItem.path,
                distItem.path
              )
            )
          } else if (sourceItem) {
            debugLine(
              messages.treeWithSourceFiles(
                name,
                'zip',
                this.browser,
                sourceItem.path
              )
            )
          } else if (distItem) {
            debugLine(
              messages.treeWithDistFilesBrowser(
                name,
                'zip',
                this.browser,
                distItem.path
              )
            )
          }
        }
      } catch (error) {
        // Surface error in build output but do not crash dev builds
        if (stats?.compilation?.warnings) {
          stats.compilation.warnings.push(
            new Error(compilationMessages.zipCreationFailed(error))
          )
        }
      }
    })
  }
}
