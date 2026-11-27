// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Manifest} from '../types'
import {codedError} from './coded-error'
import {STOCK_COMPANION_DIR} from './constants'
import {readManifest} from './manifest/source-manifest'
import * as messages from './messages'
import {CODES, stripChannelPrefix} from './messaging'
import {devtoolsEngineFor} from './paths'
import {findNearestProjectManifestDirSync} from './project-manifest'
import {realPath} from './real-path'

function hasNewTabOverride(extensionDir: string): boolean {
  const manifestPath = path.join(extensionDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return false

  try {
    const manifest = readManifest<Manifest | null>(manifestPath)
    const newtab = manifest?.chrome_url_overrides?.newtab

    return typeof newtab === 'string' && newtab.trim().length > 0
  } catch {
    // If the manifest cannot be read/parsed, keep loading behavior unchanged.
    return false
  }
}

// The fields read off a manifest.json or package.json to name an extension.
interface IdentityFields {
  name?: unknown
  browser_specific_settings?: {gecko?: {id?: unknown}}
  applications?: {gecko?: {id?: unknown}}
}

function readManifestAt(file: string): IdentityFields | undefined {
  try {
    const parsed = readManifest<unknown>(file)

    return parsed && typeof parsed === 'object'
      ? (parsed as IdentityFields)
      : undefined
  } catch {
    return undefined
  }
}

function geckoIdOf(manifest: IdentityFields | undefined) {
  const id =
    manifest?.browser_specific_settings?.gecko?.id ??
    manifest?.applications?.gecko?.id

  return typeof id === 'string' && id.trim() ? id.trim() : undefined
}

// The package names a built-in ships under, in this repository and on npm.
const BUILT_IN_PACKAGE_NAMES = {
  'extension-js-devtools': ['extension-js-devtools'],
  'extension-js-theme': ['extension-js-theme', '@extension-js/theme']
} as const

// The project is a built-in itself when it carries the built-in's gecko id or
// package name: loading both would give Firefox two add-ons with one id.
function isSameAsBuiltIn(
  builtInDir: string,
  packageName: keyof typeof BUILT_IN_PACKAGE_NAMES,
  user: {geckoId?: string; packageName?: string}
): boolean {
  if (
    user.packageName &&
    (BUILT_IN_PACKAGE_NAMES[packageName] as readonly string[]).includes(
      user.packageName
    )
  ) {
    return true
  }

  const builtInId = geckoIdOf(
    readManifestAt(path.join(builtInDir, 'manifest.json'))
  )

  return Boolean(user.geckoId && builtInId && user.geckoId === builtInId)
}

function userIdentity(outputPath: string, manifestPath?: string) {
  const manifest =
    (manifestPath ? readManifestAt(manifestPath) : undefined) ??
    readManifestAt(path.join(outputPath, 'manifest.json'))
  const projectDir = manifestPath
    ? findNearestProjectManifestDirSync(path.dirname(manifestPath), 6)
    : undefined
  const pkg = projectDir
    ? readManifestAt(path.join(projectDir, 'package.json'))
    : undefined

  return {
    geckoId: geckoIdOf(manifest),
    packageName: typeof pkg?.name === 'string' ? pkg.name : undefined
  }
}

// A built-in companion that is not there is left out without a word: the
// session runs the same, and its absence is the package's state, not the user's.
function resolveBuiltInExtensionForBrowser(input: {
  baseDir: string
  packageName: 'extension-js-devtools' | 'extension-js-theme'
  browser: string
}): string | undefined {
  const engine = devtoolsEngineFor(input.browser)
  const packageRelativeCandidates = [
    // Published package / mirrored monorepo output.
    path.join('dist', input.packageName, engine)
  ]

  // Monorepo fallback when watch rebuilds clean programs/develop/dist. Keep
  // scoped to the known package location to avoid unrelated traversal.
  const normalizedBaseDir = path.normalize(input.baseDir)
  const parentName = path.basename(path.dirname(normalizedBaseDir))
  const baseName = path.basename(normalizedBaseDir)

  if (parentName === 'programs' && baseName === 'develop') {
    packageRelativeCandidates.push(
      path.join('..', '..', 'extensions', input.packageName, 'dist', engine)
    )
  }

  for (const rel of packageRelativeCandidates) {
    const candidate = path.resolve(input.baseDir, rel)
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

// Opera ships its own theming and refuses a theme-type extension handed to
// --load-extension with a "Extension type is not supported" dialog, so the
// first thing an Opera user saw from us was a load error for a cosmetic
// companion. Yandex answers "Themes are not supported" over CDP, the only
// route that loads anything there. Edge loads it, then shows an "Installed
// theme, Undo" bar on every launch that no flag hides. The rest take the theme.
const THEME_REFUSING_BROWSERS: ReadonlySet<string> = new Set([
  'edge',
  'opera',
  'yandex'
])

function browserAcceptsThemeExtension(browser: string): boolean {
  return !THEME_REFUSING_BROWSERS.has(String(browser || '').toLowerCase())
}

// Reserved companion package names, owned by the built-in resolver. A user
// companion shadowing one would surface as a duplicate in chrome://extensions.
const RESERVED_BUILT_IN_NAMES: ReadonlySet<string> = new Set([
  'extension-js-devtools',
  'extension-js-theme'
])

function isReservedBuiltInPath(extensionPath: string): boolean {
  const base = path.basename(path.normalize(extensionPath))
  if (RESERVED_BUILT_IN_NAMES.has(base)) return true

  // Also catch nested layouts like `extensions/extension-js-devtools/dist/<engine>`
  // by checking any segment of the path.
  const segments = path.normalize(extensionPath).split(path.sep)

  return segments.some((segment) => RESERVED_BUILT_IN_NAMES.has(segment))
}

function explicitCompanionEntries(config: unknown): string[] {
  const entries = Array.isArray(config)
    ? config
    : (config as {paths?: unknown} | null | undefined)?.paths

  return Array.isArray(entries)
    ? entries.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function isFolder(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

// The scan reads a folder only under the spelling the config gave it, so a
// folder that differs by case on a case-blind disk counts as not there.
function isFolderAsSpelled(target: string): boolean {
  if (!isFolder(target)) return false

  try {
    return fs.readdirSync(path.dirname(target)).includes(path.basename(target))
  } catch {
    return false
  }
}

const STORE_HOSTS: ReadonlySet<string> = new Set([
  'chromewebstore.google.com',
  'chrome.google.com',
  'microsoftedge.microsoft.com',
  'addons.mozilla.org'
])

// A link carries a web scheme, or opens with a store host and no scheme.
// Nothing is fetched without a browser, so a link is only told apart here.
function isWebLink(entry: string): boolean {
  try {
    const {protocol} = new URL(entry)

    return protocol === 'http:' || protocol === 'https:'
  } catch {
    // Not an absolute URL, so only the scheme-less store form is left.
  }

  const host = /^([a-z0-9.-]+)(?:[/?#].*)?$/i.exec(entry)?.[1]

  return host
    ? STORE_HOSTS.has(host.toLowerCase().replace(/^www\./, ''))
    : false
}

function isPathLike(entry: string, projectRoot: string): boolean {
  if (path.isAbsolute(entry)) return true
  if (entry.includes('/') || entry.includes('\\')) return true

  // A folder that is there is a folder, whatever its name looks like.
  return entry.trim().length > 0 && isFolder(path.resolve(projectRoot, entry))
}

type PlaceInProject = 'same' | 'inside' | 'outside'

// Real paths on both sides, so a link inside the project that leads out of
// it counts as outside.
function placeInProject(projectRoot: string, target: string): PlaceInProject {
  const fromRoot = path.relative(realPath(projectRoot), realPath(target))

  if (fromRoot === '') return 'same'

  return fromRoot === '..' ||
    fromRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fromRoot)
    ? 'outside'
    : 'inside'
}

// Every refusal below reads word for word as the launch path throws it, so
// the same entry gets the same answer with or without a browser.
function companionRefusal(text: string, name?: string): Error {
  const error = codedError(CODES.E_COMPANION_EXTENSION_PATH, text)

  if (name) error.name = name

  return error
}

// An entry that is no web link and no folder path: a bare store id gets the
// link it needs, anything else is named as unknown.
export function unknownCompanionEntryError(entry: string): Error {
  return /^[a-p]{32}$/i.test(entry)
    ? companionRefusal(
        messages.companionEntryLooksLikeStoreId(entry),
        'CompanionEntryLooksLikeStoreId'
      )
    : companionRefusal(
        messages.companionEntryNotLinkOrFolder(entry),
        'CompanionEntryNotLinkOrFolder'
      )
}

export function companionLinkNotAStoreLinkError(entry: string): Error {
  return companionRefusal(
    messages.companionLinkNotAStoreLink(entry),
    'CompanionLinkNotAStoreLink'
  )
}

// The folders a config names, once every entry passed the rules the launch
// path applies: inside the project, and either a link or a folder path.
export function namedCompanionFoldersInsideProject(
  config: unknown,
  projectRoot: string
): string[] {
  const folders: string[] = []

  for (const entry of explicitCompanionEntries(config)) {
    if (isWebLink(entry)) continue

    if (!isPathLike(entry, projectRoot)) throw unknownCompanionEntryError(entry)

    const folder = path.resolve(projectRoot, entry)

    // The project itself is the extension being run, never its companion.
    if (placeInProject(projectRoot, folder) !== 'inside') {
      throw companionRefusal(
        'Companion extensions must be inside the project.\n' +
          `Invalid path: ${folder}`
      )
    }

    folders.push(entry)
  }

  return folders
}

// The folder a config says to scan, once it is known to sit in the project.
export function companionScanDirInsideProject(
  config: unknown,
  projectRoot: string
): string | undefined {
  const dir = declaredScanDir(config)

  if (!dir) return undefined

  const folder = path.resolve(projectRoot, dir)

  // A scan of the project itself would meet its own source and output.
  if (placeInProject(projectRoot, folder) !== 'inside') {
    throw companionRefusal(
      `extensions.dir must be inside the project.\nInvalid dir: ${folder}`
    )
  }

  return dir
}

function linksIn(folder: string): string[] {
  try {
    return fs
      .readdirSync(folder, {withFileTypes: true})
      .filter((entry) => entry.isSymbolicLink() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function plainFoldersIn(folder: string): string[] {
  try {
    return fs
      .readdirSync(folder, {withFileTypes: true})
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

// The scan meets entries nobody named. A link among them that leads out of
// the project is left out and said, and the entries beside it are untouched.
export function scannedCompanionsOutsideProject(input: {
  projectRoot: string
  // The scan folder as the config spells it, already known to be inside.
  dir?: string
}): UnresolvedCompanion[] {
  if (!input.dir) return []

  const scanRoot = path.resolve(input.projectRoot, input.dir)
  // The scan reads the folder and one level of grouping folders below it.
  const groups = [
    '',
    ...plainFoldersIn(scanRoot).filter(
      (name) => !fs.existsSync(path.join(scanRoot, name, 'manifest.json'))
    )
  ]
  const outside: UnresolvedCompanion[] = []

  for (const group of groups) {
    for (const name of linksIn(path.join(scanRoot, group))) {
      const link = path.join(scanRoot, group, name)

      if (placeInProject(input.projectRoot, link) !== 'outside') continue

      const frame = messages.scannedCompanionOutsideProject(
        [input.dir.replace(/[\\/]+$/, ''), group, name]
          .filter(Boolean)
          .join('/'),
        realPath(link)
      )

      outside.push({
        manifestPath: link,
        frame,
        coded: `${CODES.W_COMPANION_EXTENSION_PATH}: ${stripChannelPrefix(frame)}`
      })
    }
  }

  return outside
}

// Which layer the companions came from, in the order the commands merge them.
// A folder scan names no companion, so it answers nothing.
export function companionsDeclaredIn(
  command: string,
  layers: {
    flag?: unknown
    command?: unknown
    browser?: unknown
    project?: unknown
  }
): string | undefined {
  if (layers.flag != null) return 'the --extensions flag'

  if (layers.command != null) {
    return `commands.${command}.extensions in extension.config.js`
  }

  if (layers.browser != null) {
    return 'the browser section of extension.config.js'
  }

  if (layers.project != null) return 'extensions in extension.config.js'

  return undefined
}

function declaredScanDir(config: unknown): string | undefined {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return undefined
  }

  const dir = (config as {dir?: unknown}).dir

  return typeof dir === 'string' && dir.trim() ? dir.trim() : undefined
}

interface UnresolvedCompanion {
  // What was looked for and is not there: the manifest.json of a named
  // companion, or the folder a declared extensions.dir names.
  manifestPath: string
  // The framed sentence a terminal reads.
  frame: string
  // The same sentence with its code, as an envelope's warnings array holds it.
  coded: string
}

// A companion named by path that is not an unpacked extension is left out of
// the load, and without a word a typo runs the session one extension short.
export function unresolvedNamedCompanions(input: {
  projectRoot: string
  // The entries once store links became folders.
  resolved: unknown
  // The entries as written, to name the one that fails the way it was typed.
  declared?: unknown
  declaredIn?: string
}): UnresolvedCompanion[] {
  const asWritten = new Map<string, string>()

  for (const entry of explicitCompanionEntries(input.declared)) {
    asWritten.set(path.resolve(input.projectRoot, entry), entry)
  }

  const unresolved: UnresolvedCompanion[] = []
  const scanDir = declaredScanDir(input.resolved)

  // A folder some layer declared and that is not there loads nothing, and
  // without a word a typo runs the session with no companion at all.
  if (scanDir && (input.declaredIn || scanDir !== STOCK_COMPANION_DIR)) {
    const folder = path.resolve(input.projectRoot, scanDir)

    if (!isFolderAsSpelled(folder)) {
      const frame = messages.companionExtensionsFolderNotFound(
        scanDir,
        folder,
        input.declaredIn ?? 'the extensions option'
      )

      unresolved.push({
        manifestPath: folder,
        frame,
        coded: `${CODES.W_COMPANION_EXTENSION_PATH}: ${stripChannelPrefix(frame)}`
      })
    }
  }

  for (const entry of explicitCompanionEntries(input.resolved)) {
    const folder = path.resolve(input.projectRoot, entry)
    const manifestPath = path.join(folder, 'manifest.json')

    try {
      if (fs.statSync(manifestPath).isFile()) continue
    } catch {
      // Reported below, the same as a manifest.json that is a folder.
    }

    if (unresolved.some((known) => known.manifestPath === manifestPath)) {
      continue
    }

    const frame = messages.companionExtensionNotResolved(
      asWritten.get(folder) ?? entry,
      manifestPath,
      input.declaredIn ?? 'the extensions option'
    )

    unresolved.push({
      manifestPath,
      frame,
      coded: `${CODES.W_COMPANION_EXTENSION_PATH}: ${stripChannelPrefix(frame)}`
    })
  }

  return unresolved
}

// The compiler config is built again on every restart of a session, and by
// then the command may have said it already with the layer it came from.
const companionsWarnedAbout = new Set<string>()

export function isFirstCompanionWarning(manifestPath: string): boolean {
  if (companionsWarnedAbout.has(manifestPath)) return false

  companionsWarnedAbout.add(manifestPath)

  return true
}

function dedupeByResolvedPath(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const entry of paths) {
    const resolved = path.resolve(entry)
    if (seen.has(resolved)) continue

    seen.add(resolved)
    result.push(entry)
  }

  return result
}

export function computeExtensionsToLoad(
  baseDir: string,
  mode: 'development' | 'production' | 'none' | string | undefined,
  browser: string,
  userExtensionOutputPath: string,
  extraExtensionDirs: string[] = [],
  userManifestPath?: string
): string[] {
  const list: string[] = []

  try {
    // The devtools companion serves a development session. A production
    // build is loaded as it ships, with the theme alone beside it.
    const devtoolsForBrowser =
      mode === 'production'
        ? undefined
        : resolveBuiltInExtensionForBrowser({
            baseDir,
            packageName: 'extension-js-devtools',
            browser
          })
    const themeForBrowser = resolveBuiltInExtensionForBrowser({
      baseDir,
      packageName: 'extension-js-theme',
      browser
    })

    const userHasNewTabOverride =
      hasNewTabOverride(userExtensionOutputPath) ||
      (typeof userManifestPath === 'string'
        ? hasNewTabOverride(path.dirname(userManifestPath))
        : false)
    const devtoolsHasNewTabOverride = devtoolsForBrowser
      ? hasNewTabOverride(devtoolsForBrowser)
      : false

    // Keep built-in blank NTP only when the user extension does not provide one.
    // This avoids any NTP conflict while preserving a deterministic default page.
    const shouldSkipDevtoolsForNtpConflict =
      userHasNewTabOverride && devtoolsHasNewTabOverride

    const user = userIdentity(userExtensionOutputPath, userManifestPath)

    if (
      devtoolsForBrowser &&
      !shouldSkipDevtoolsForNtpConflict &&
      !isSameAsBuiltIn(devtoolsForBrowser, 'extension-js-devtools', user)
    ) {
      list.push(devtoolsForBrowser)
    }

    if (
      themeForBrowser &&
      browserAcceptsThemeExtension(browser) &&
      !isSameAsBuiltIn(themeForBrowser, 'extension-js-theme', user)
    ) {
      list.push(themeForBrowser)
    }
  } catch {
    // Built-ins are optional, so one that cannot be read is left out.
  }

  // Add companions (load-only) before the user extension; skip paths that
  // shadow a reserved built-in to avoid a second devtools/theme load.
  const resolvedUserOutputPath = path.resolve(userExtensionOutputPath)

  for (const p of extraExtensionDirs) {
    if (isReservedBuiltInPath(p)) continue
    // The final dedupe keeps the FIRST hit, so a companion naming the user
    // extension would freeze it in this earlier slot: drop it to keep it last.
    if (path.resolve(p) === resolvedUserOutputPath) continue

    list.push(p)
  }

  // Always load the user extension last to give it precedence on conflicts
  list.push(userExtensionOutputPath)

  // Final dedupe: companion config + user output + resolved built-in could
  // emit the same absolute path twice, and Chrome renders it twice on launch.
  return dedupeByResolvedPath(list)
}
