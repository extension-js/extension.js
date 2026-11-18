// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {codedError} from './coded-error'
import * as messages from './messages'
import {CODES, stripChannelPrefix} from './messaging'
import {parseAuthoredJson} from './parse-json-safe'
import {devtoolsEngineFor} from './paths'
import {realPath} from './real-path'

function hasNewTabOverride(extensionDir: string): boolean {
  const manifestPath = path.join(extensionDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return false

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8')
    const manifest = parseAuthoredJson(raw)
    const newtab = manifest?.chrome_url_overrides?.newtab

    return typeof newtab === 'string' && newtab.trim().length > 0
  } catch {
    // If the manifest cannot be read/parsed, keep loading behavior unchanged.
    return false
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
// route that loads anything there. Every other Chromium target takes the theme.
const THEME_REFUSING_BROWSERS: ReadonlySet<string> = new Set([
  'opera',
  'yandex'
])

export function browserAcceptsThemeExtension(browser: string): boolean {
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

// The entries that name a folder, told apart from a store link without the
// resolver that would fetch one: a link has a scheme or opens with a host.
export function namedCompanionFolders(
  config: unknown,
  projectRoot?: string
): string[] {
  return explicitCompanionEntries(config).filter((entry) => {
    // A folder that is there is a folder, whatever its name looks like.
    if (projectRoot && isFolder(path.resolve(projectRoot, entry))) return true

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) return false
    if (path.isAbsolute(entry) || entry.startsWith('.')) return true

    const [first, ...rest] = entry.split(/[\\/]/)

    return rest.length > 0 && !first.includes('.')
  })
}

// A companion the user names may sit anywhere inside the project. Real paths
// are compared, so a link inside the project that leads out is refused too.
export function namedCompanionFoldersInsideProject(
  config: unknown,
  projectRoot: string
): string[] {
  const root = realPath(projectRoot)

  return namedCompanionFolders(config, projectRoot).map((entry) => {
    const folder = path.resolve(projectRoot, entry)
    const fromRoot = path.relative(root, realPath(folder))
    const outside =
      fromRoot === '..' ||
      fromRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(fromRoot)

    if (outside) {
      throw codedError(
        CODES.E_COMPANION_EXTENSION_PATH,
        messages.companionExtensionOutsideProject(folder)
      )
    }

    return entry
  })
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

// The folder the commands scan when no layer says which one. Its absence
// is the usual state of a project, so it is never spoken of on its own.
const STOCK_SCAN_DIR = './extensions'

function declaredScanDir(config: unknown): string | undefined {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return undefined
  }

  const dir = (config as {dir?: unknown}).dir

  return typeof dir === 'string' && dir.trim() ? dir.trim() : undefined
}

export interface UnresolvedCompanion {
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
  if (scanDir && (input.declaredIn || scanDir !== STOCK_SCAN_DIR)) {
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
        coded: `${CODES.E_COMPANION_EXTENSION_PATH}: ${stripChannelPrefix(frame)}`
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
      coded: `${CODES.E_COMPANION_EXTENSION_PATH}: ${stripChannelPrefix(frame)}`
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

    if (devtoolsForBrowser && !shouldSkipDevtoolsForNtpConflict) {
      list.push(devtoolsForBrowser)
    }

    if (themeForBrowser && browserAcceptsThemeExtension(browser)) {
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
