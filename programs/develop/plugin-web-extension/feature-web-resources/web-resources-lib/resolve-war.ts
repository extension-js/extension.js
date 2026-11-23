// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, sources, WebpackError} from '@rspack/core'
import {
  type AssetHashOptions,
  bundledAssetOutputName
} from '../../../lib/asset-output-name'
import {isGeckoBasedBrowser, isWebkitBasedBrowser} from '../../../lib/constants'
import {templateCopiedAsset} from '../../../lib/copied-asset-env'
import {readManifest} from '../../../lib/manifest/source-manifest'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {
  hasPrivateFileName,
  privateFileKind,
  rootAbsoluteClimbsOut,
  sourceFileMayShip
} from '../../../lib/public-private-files'
import type {DevOptions, Manifest} from '../../../types'
import {webAccessibleResources} from '../../feature-manifest/manifest-overrides/common/web_accessible_resources'
import {normalizeManifestOutputPath} from '../../feature-manifest/normalize-manifest-path'
import {
  extractGetURLLiterals,
  resolveExtensionPath
} from '../../feature-scripts/steps/trace-runtime-loaded-files'
import {unixify} from '../../shared/paths'
import * as warMessages from './messages'

// The files this step copied as written, per compile. A bundled stylesheet
// had its url() targets resolved by the bundler, a copied one did not.
const copiedAsWritten = new WeakMap<Compilation, Set<string>>()

function emitCopy(
  compilation: Compilation,
  name: string,
  source: sources.Source
) {
  compilation.emitAsset(name, source)

  const copied = copiedAsWritten.get(compilation) || new Set<string>()
  copied.add(name)
  copiedAsWritten.set(compilation, copied)
}

// The listed files this step copied into a compile, by output name.
export function listedCopiesOf(compilation: Compilation): Set<string> {
  return new Set(copiedAsWritten.get(compilation) || [])
}

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]*))\s*\)/gi
// A scheme, a protocol-relative address or a fragment is not a packaged file.
const NOT_A_PACKAGED_FILE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|$)/i

// The packaged paths a copied stylesheet names with url(), as the browser
// resolves them from where the sheet is served.
function urlTargetsOfCopiedSheet(name: string, css: string): string[] {
  const targets = new Set<string>()

  for (const match of css.replace(CSS_COMMENT, '').matchAll(CSS_URL)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (NOT_A_PACKAGED_FILE.test(raw)) continue

    const file = raw.split(/[?#]/)[0]
    const resolved = file.startsWith('/')
      ? path.posix.normalize(file.slice(1))
      : path.posix.join(path.posix.dirname(name), file)

    if (resolved && !resolved.startsWith('..')) targets.add(resolved)
  }

  return [...targets].sort()
}

function warnCopiedSheetsWithUnshippedTargets(compilation: Compilation) {
  const copied = [...(copiedAsWritten.get(compilation) || [])].sort()

  for (const name of copied) {
    if (!/\.css$/i.test(name)) continue

    const text = compilation.getAsset(name)?.source.source()
    if (text === undefined) continue

    const missing = urlTargetsOfCopiedSheet(name, text.toString()).filter(
      (target) => !compilation.getAsset(target)
    )
    if (missing.length === 0) continue

    const warn = new WebpackError(
      warMessages.warSheetTargetsNotShipped(name, missing)
    ) as Error & {file?: string; name?: string}
    warn.file = name
    warn.name = 'WARStylesheetTargetNotShipped'
    compilation.warnings.push(warn)
  }
}

function isPublicRootLike(possiblePath: string) {
  const normalizedPath = unixify(possiblePath || '')

  return (
    normalizedPath.startsWith('/') ||
    /^(?:\.\/)?public\//i.test(normalizedPath) ||
    /^\/public\//i.test(normalizedPath)
  )
}

function toPublicOutput(possiblePath: string) {
  const normalizedPath = unixify(possiblePath || '')

  if (/^\/public\//i.test(normalizedPath)) {
    return normalizedPath.replace(/^\/public\//i, '')
  } else if (/^(?:\.\/)?public\//i.test(normalizedPath)) {
    return normalizedPath.replace(/^(?:\.\/)?public\//i, '')
  } else if (/^\//.test(normalizedPath)) {
    return normalizedPath.replace(/^\//, '')
  }

  return normalizedPath
}

// A WAR entry may name a directory; reading it as a file throws EISDIR, so
// emit each contained file individually, preserving manifest-relative paths.
function emitDirectoryAsAssets(
  compilation: Compilation,
  absDir: string,
  baseDir: string,
  mayShip: (abs: string) => boolean,
  onWithheld: (abs: string) => void
): void {
  const walk = (dir: string) => {
    let entries: fs.Dirent[]

    try {
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)

      if (!mayShip(full)) {
        onWithheld(full)
        continue
      }

      if (entry.isDirectory()) {
        walk(full)
        continue
      }

      if (!entry.isFile()) continue

      const outName = unixify(path.relative(baseDir, full))

      if (!compilation.getAsset(outName)) {
        emitCopy(
          compilation,
          outName,
          new sources.RawSource(
            templateCopiedAsset(compilation, outName, fs.readFileSync(full))
          )
        )
      }

      compilation.fileDependencies.add(full)
    }
  }

  walk(absDir)
}

const GLOB_SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])
// Sources the build compiles never ship raw: the browser cannot run them.
const GLOB_SKIP_SOURCES = /\.(?:ts|tsx|mts|cts|jsx|vue|svelte|scss|sass|less)$/i

// Chrome serves every packaged file a `*` pattern matches, `/` included, so a
// glob under a folder ships each matching source file at its own path. A
// pattern with no folder before its first `*` names the built output itself.
function emitGlobMatches(
  compilation: Compilation,
  manifestDir: string,
  projectPath: string,
  res: string,
  mayShip: (abs: string) => boolean,
  // `named` is true for the folder the pattern itself spells out.
  onWithheld: (abs: string, named?: boolean) => void
): void {
  const pattern = unixify(res).replace(/^\.?\//, '')
  const prefix = pattern.slice(0, pattern.indexOf('*')).replace(/[^/]*$/, '')
  const folder = prefix.replace(/\/+$/, '')

  if (!folder || /^public(\/|$)/i.test(folder)) return
  if (fs.existsSync(path.join(projectPath, 'public', folder))) return

  const base = path.join(manifestDir, folder)
  if (!isDirectory(base)) return

  if (!mayShip(base)) {
    onWithheld(base, true)

    return
  }

  const matcher = new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`
  )

  const walk = (dir: string) => {
    let entries: fs.Dirent[]

    try {
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (GLOB_SKIP_DIRS.has(entry.name)) continue

        if (mayShip(full)) walk(full)
        else onWithheld(full)

        continue
      }

      if (!entry.isFile()) continue

      const outName = unixify(path.relative(manifestDir, full))
      if (!matcher.test(outName) || GLOB_SKIP_SOURCES.test(outName)) continue

      if (!mayShip(full)) {
        onWithheld(full)
        continue
      }

      if (!compilation.getAsset(outName)) {
        emitCopy(
          compilation,
          outName,
          new sources.RawSource(
            templateCopiedAsset(compilation, outName, fs.readFileSync(full))
          )
        )
      }

      compilation.fileDependencies.add(full)
    }
  }

  walk(base)
  compilation.contextDependencies?.add(base)
}

function isDirectory(abs: string): boolean {
  try {
    return fs.statSync(abs).isDirectory()
  } catch {
    return false
  }
}

// Named the way the bundler names the same bytes, so a sheet or an import
// reaching for this file shares the one copy instead of adding a second.
function emitFileAsAsset(compilation: Compilation, absPath: string): string {
  const content = fs.readFileSync(absPath)
  const outName = bundledAssetOutputName(
    absPath,
    content,
    (compilation as {outputOptions?: AssetHashOptions}).outputOptions
  )

  if (!compilation.getAsset(outName)) {
    emitCopy(
      compilation,
      outName,
      new sources.RawSource(templateCopiedAsset(compilation, outName, content))
    )
  }

  compilation.fileDependencies.add(absPath)

  return unixify(outName)
}

// The override rewrites source extensions before resolution, so a missing
// src/x.js may really be src/x.ts; find the original for the warning.
function findSourceSibling(absOutputPath: string): string | undefined {
  const candidatesByExt: Record<string, string[]> = {
    '.js': ['.ts', '.tsx', '.jsx', '.vue', '.svelte'],
    '.css': ['.scss', '.sass', '.less'],
    '.html': ['.njk', '.nunjucks']
  }
  const ext = path.extname(absOutputPath)
  const sourceExts = candidatesByExt[ext]
  if (!sourceExts) return undefined

  for (const sourceExt of sourceExts) {
    const candidate = absOutputPath.slice(0, -ext.length) + sourceExt
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

function isFirefox(browser?: string) {
  // Family classification, not binary selection: waterfox/librewolf must get
  // firefox-shaped web_accessible_resources too.
  return !!browser && isGeckoBasedBrowser(browser.toLowerCase())
}

function isWebkit(browser?: string) {
  // The pattern contract below is verified against Chrome's loader only, and
  // Safari's loader is the converter plus WebKit, so webkit targets skip it.
  return !!browser && isWebkitBasedBrowser(browser.toLowerCase())
}

function isValidChromeMatchPattern(pattern: string): boolean {
  // Special token is allowed by Chrome for WAR
  if (pattern === '<all_urls>') return true

  if (/[?#]/.test(pattern)) return false

  if (!pattern.endsWith('/*')) return false

  // Chrome loads WAR match patterns with a port wildcard (verified live); ':*'
  // is not URL-parseable, so normalize to a concrete port before parsing.
  const parseable = pattern
    .replace(/^\*:\/\//, 'https://')
    .replace(/:\*(\/)/, ':65535$1')

  try {
    const u = new URL(parseable)

    return u.pathname === '/*'
  } catch {
    return false
  }
}

function validateMatchesOrReport(
  compilation: Compilation,
  matches: string[] | undefined,
  browser?: string
) {
  if (!matches || isFirefox(browser) || isWebkit(browser)) return

  for (const m of matches) {
    if (!isValidChromeMatchPattern(m)) {
      const msg = warMessages.warInvalidMatchPattern(m)
      const err = new WebpackError(msg) as Error & {
        file?: string
        name?: string
      }
      err.file = 'manifest.json'
      err.name = 'WARInvalidMatchPattern'
      compilation.errors.push(err)
    }
  }
}

type DeclaredWAR = Array<string | {resources?: string[]; matches?: string[]}>

function declaredWAR(manifest: unknown): DeclaredWAR | undefined {
  const war = (manifest as {web_accessible_resources?: unknown})
    .web_accessible_resources

  return Array.isArray(war) ? (war as DeclaredWAR) : undefined
}

// Each resource of the source manifest, keyed by the path the manifest
// override turns it into, so a warning can quote what the author wrote.
function authoredSpellings(
  manifestPath: string,
  browser?: string
): Map<string, string[]> {
  const spellings = new Map<string, string[]>()
  let war: DeclaredWAR | undefined

  try {
    war = declaredWAR(
      filterKeysForThisBrowser(
        readManifest(manifestPath),
        (browser || 'chrome') as DevOptions['browser']
      )
    )
  } catch {
    return spellings
  }

  for (const entry of war || []) {
    const resources =
      typeof entry === 'string'
        ? [entry]
        : Array.isArray(entry?.resources)
          ? entry.resources
          : []

    for (const written of resources) {
      if (typeof written !== 'string') continue

      const output = webAccessibleResources({
        web_accessible_resources: [written]
      } as Manifest)?.web_accessible_resources?.[0]
      if (typeof output !== 'string') continue

      spellings.set(output, [...(spellings.get(output) || []), written])
    }
  }

  return spellings
}

// The author's own mistakes in the key, reported before any resolution so a
// compile that already failed elsewhere still names them.
export function validateUserDeclaredWAR(
  compilation: Compilation,
  manifest: unknown,
  browser?: string
) {
  const war = declaredWAR(manifest)

  if (!war) return

  const isMv2 = (manifest as {manifest_version?: number}).manifest_version !== 3

  for (const entry of war) {
    if (typeof entry === 'string') {
      if (isMv2) continue

      const msg = warMessages.warStringEntryInMv3(entry)
      const err = new WebpackError(msg) as Error & {
        file?: string
        name?: string
      }
      err.file = 'manifest.json'
      err.name = 'WARStringEntryInMv3'
      compilation.errors.push(err)

      continue
    }

    if (!entry || typeof entry !== 'object') continue

    validateMatchesOrReport(compilation, entry.matches || [], browser)
  }
}

// The project-root-relative path of a ref that resolves outside the
// manifest folder but inside the project, or of a plain ref that is missing
// beside the manifest; undefined when the manifest folder is the root.
function rootRelativeOf(
  projectPath: string,
  manifestDir: string,
  abs: string,
  res: string
): string | undefined {
  if (path.resolve(projectPath) === path.resolve(manifestDir)) {
    return undefined
  }

  if (path.isAbsolute(res)) return undefined

  const fromManifest = unixify(path.relative(projectPath, abs))
  const plain = unixify(res).replace(/^\.\//, '')

  if (fromManifest.startsWith('..')) return undefined
  if (fs.existsSync(abs) && !unixify(res).startsWith('..')) return undefined

  const candidate = unixify(res).startsWith('..') ? fromManifest : plain

  return candidate && !candidate.startsWith('..') ? candidate : undefined
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

// The root-relative paths the emitted bundles ask the browser for by name.
function collectRuntimeNamedPaths(compilation: Compilation): Set<string> {
  const named = new Set<string>()
  const assets =
    typeof compilation.getAssets === 'function' ? compilation.getAssets() : []

  for (const asset of assets) {
    if (!/\.js$/i.test(String(asset.name))) continue

    for (const literal of extractGetURLLiterals(
      asset.source.source().toString()
    )) {
      const resolved = resolveExtensionPath(literal, '')
      if (resolved) named.add(resolved)
    }
  }

  return named
}

// The one source file a declared resource names and the path it ships at,
// by the same order the resolver below walks. Globs, folders, public files
// and misses name no single source.
export function declaredResourceSource(
  manifestPath: string,
  projectPath: string | undefined,
  res: string
): {source: string; output: string} | undefined {
  const manifestDir = path.dirname(manifestPath)
  const root = projectPath || manifestDir
  // A source the build withholds ships nowhere, so it names no output.
  const mayShip = (abs: string) => sourceFileMayShip(abs, [root, manifestDir])

  if (!res || path.isAbsolute(res) || /[*?[\]{}]/.test(res)) return undefined
  if (isPublicRootLike(res)) return undefined

  const normalizedOutput = normalizeManifestOutputPath(res)

  if (
    !normalizedOutput.split('/').includes('..') &&
    fs.existsSync(path.join(root, 'public', normalizedOutput))
  ) {
    return undefined
  }

  const abs = path.join(manifestDir, res)
  const rootRel = rootRelativeOf(root, manifestDir, abs, res)

  if (rootRel) {
    const rootAbs = path.join(root, rootRel)

    return isFile(rootAbs) && mayShip(rootAbs)
      ? {source: rootAbs, output: rootRel}
      : undefined
  }

  const output = unixify(path.relative(manifestDir, abs))

  return isFile(abs) && !output.startsWith('..') && mayShip(abs)
    ? {source: abs, output}
    : undefined
}

export function resolveUserDeclaredWAR(
  compilation: Compilation,
  manifestPath: string,
  manifest: unknown,
  browser?: string
) {
  const v2 = new Set<string>()
  const v3: Array<{
    matches: string[]
    resources: Set<string>
    extra?: Record<string, unknown>
    // The author's group had no matches key, as an extension_ids group has.
    matchesAbsent?: boolean
  }> = []

  const manifestObj = manifest as {manifest_version?: number}
  const war = declaredWAR(manifest)

  if (!war) return {v2, v3}

  validateUserDeclaredWAR(compilation, manifest, browser)

  // String entries are the MV2 format; invalid in MV3 (Chrome rejects at load),
  // so they were reported above. Detection is per entry, not war[0].
  const isMv2 = manifestObj.manifest_version !== 3
  const manifestDir = path.dirname(manifestPath)
  const projectPath = (compilation.options?.context as string) || manifestDir
  // The emitted manifest names a public/ or root entry by its output path,
  // so the author's spelling comes from the source, in the order written.
  const spellings = authoredSpellings(manifestPath, browser)

  let runtimeNamedPaths: Set<string> | undefined

  const namedAtRuntime = (outputPath: string) => {
    runtimeNamedPaths ??= collectRuntimeNamedPaths(compilation)

    return runtimeNamedPaths.has(outputPath)
  }

  // An entry that names one file may reach into an installed package. A
  // folder entry or a pattern is walked, and a walk never enters one.
  const mayShip = (abs: string) =>
    sourceFileMayShip(abs, [projectPath, manifestDir])
  const mayShipWalked = (abs: string) =>
    sourceFileMayShip(abs, [projectPath, manifestDir], 'walked')
  const saidWithheld = new Set<string>()

  // A source the build will not copy gets the finding a missing file gets.
  const reportWithheld = (abs: string, ref: string) => {
    const said = `${ref}\n${abs}`
    if (saidWithheld.has(said)) return

    saidWithheld.add(said)

    // Named from the project, so no line carries a path of the machine.
    const warn = new WebpackError(
      warMessages.warFieldError(unixify(path.relative(projectPath, abs)), {
        relativeRef: ref
      })
    ) as Error & {file?: string; name?: string}
    warn.file = 'manifest.json'
    warn.name = 'WARRelativeAssetMissing'
    compilation.warnings.push(warn)
  }

  // Inside a folder or a pattern, OS metadata and repository files are left
  // out without a word, the way the public/ copy leaves them out.
  const reportWithheldInside = (abs: string) => {
    const kind = privateFileKind(path.basename(abs))
    if (kind === 'os' || kind === 'tooling') return

    reportWithheld(abs, unixify(path.relative(manifestDir, abs)))
  }

  let authorGroupHasNoMatches = false

  const pushResource = (
    matches: string[] | undefined,
    resource: string,
    extra?: Record<string, unknown>
  ) => {
    if (isMv2) {
      v2.add(resource)

      return
    }

    const key = (matches || []).join(',')
    let group = v3.find((g) => g.matches.join(',') === key)

    if (!group) {
      group = {
        matches: matches || [],
        resources: new Set(),
        extra,
        ...(authorGroupHasNoMatches ? {matchesAbsent: true} : {})
      }

      v3.push(group)
    } else if (extra && !group.extra) {
      group.extra = extra
    }

    group.resources.add(resource)
  }

  const handleOne = (
    matches: string[] | undefined,
    declared: string,
    extra?: Record<string, unknown>
  ) => {
    const written = spellings.get(declared)?.shift() ?? declared
    // A manifest read before the override is brought to the form it gives.
    const res =
      !/[*?[\]{}]/.test(declared) &&
      !rootAbsoluteClimbsOut(declared) &&
      isPublicRootLike(declared)
        ? normalizeManifestOutputPath(declared)
        : declared

    // Fast-path: a resource resolving to a real file under public/ is accepted
    // without warning, aligned with icons and manifest validation.
    const normalizedOutput = normalizeManifestOutputPath(res)
    const publicCandidate = path.join(projectPath, 'public', normalizedOutput)
    // `public/../x` joins to a real file outside public/, and the raw `..`
    // path would land in the manifest; a `..` ref is never a public file.
    const escapesPublic = normalizedOutput.split('/').includes('..')
    const isPattern = /[*?[\]{}]/.test(res)

    // The manifest step keeps a climbing root path as written, slash first.
    const climbsOut = rootAbsoluteClimbsOut(res)

    // Asked before public/: the copier leaves these names out as well, so
    // the folder cannot answer for one. A page refuses `/../x` the same way.
    if (
      !isPattern &&
      (climbsOut ||
        hasPrivateFileName(path.posix.normalize(unixify(normalizedOutput))))
    ) {
      reportWithheld(
        path.join(manifestDir, normalizedOutput),
        climbsOut ? normalizedOutput : res
      )

      return
    }

    if (!escapesPublic && fs.existsSync(publicCandidate)) {
      pushResource(matches, normalizedOutput, extra)

      return
    }

    if (isPattern) {
      // A pattern with a parent segment names nothing inside the build, and
      // copying its matches would write outside the output folder.
      if (unixify(res).split('/').includes('..')) {
        const warn = new WebpackError(
          warMessages.warPatternLeavesRoot(res)
        ) as Error & {file?: string; name?: string}
        warn.file = 'manifest.json'
        warn.name = 'WARPatternLeavesRoot'
        compilation.warnings.push(warn)

        return
      }

      // A pattern whose own folder is withheld matches nothing that ships.
      let folderWithheld = false

      emitGlobMatches(
        compilation,
        manifestDir,
        projectPath,
        res,
        mayShipWalked,
        (abs, named) => {
          if (!named) return reportWithheldInside(abs)

          folderWithheld = true
          reportWithheld(abs, res)
        }
      )

      if (!folderWithheld) pushResource(matches, res, extra)

      return
    }

    const abs = path.isAbsolute(res) ? res : path.join(manifestDir, res)

    // A ref the special folders own (pages/, scripts/) lives at the project
    // root, not beside a src/ manifest. Spelled from either place, it names
    // the compiled asset at its root-relative path, or ships the file there.
    const rootRel = rootRelativeOf(projectPath, manifestDir, abs, res)

    // A file or a folder the build may not copy is never read: a private
    // name, a place outside the project, or a folder of installed packages.
    const withheld = [
      abs,
      rootRel ? path.join(projectPath, rootRel) : abs
    ].find(
      (candidate) =>
        fs.existsSync(candidate) &&
        !(isDirectory(candidate) ? mayShipWalked : mayShip)(candidate)
    )

    if (withheld) {
      reportWithheld(withheld, res)

      return
    }

    if (rootRel) {
      const compiled =
        typeof compilation.getAsset === 'function'
          ? compilation.getAsset(rootRel)
          : undefined
      const rootAbs = path.join(projectPath, rootRel)

      if (compiled && compiled.name === rootRel) {
        pushResource(matches, rootRel, extra)

        return
      }

      if (isFile(rootAbs)) {
        // Spelled as the root path, or asked for by a runtime literal, the
        // file is served there. Otherwise the bundler-named copy is the one.
        const spelledAsRoot = unixify(res).replace(/^\.\//, '') === rootRel

        if (spelledAsRoot || namedAtRuntime(rootRel)) {
          if (!compilation.getAsset(rootRel)) {
            emitCopy(
              compilation,
              rootRel,
              new sources.RawSource(
                templateCopiedAsset(
                  compilation,
                  rootRel,
                  fs.readFileSync(rootAbs)
                )
              )
            )
          }

          compilation.fileDependencies.add(rootAbs)
          pushResource(matches, rootRel, extra)

          return
        }

        pushResource(matches, emitFileAsAsset(compilation, rootAbs), extra)

        return
      }
    }

    if (!fs.existsSync(abs)) {
      const publicAbsMaybe = path.join(projectPath, 'public', res)
      const asset2 =
        typeof compilation.getAsset === 'function'
          ? compilation.getAsset(res)
          : undefined
      // A copy an earlier build left in the output folder is not the file:
      // only what this build emits counts, as in a build into an empty one.
      const assetEmitted = Boolean(asset2 && asset2.name === res)

      if (fs.existsSync(publicAbsMaybe) || assetEmitted) {
        // In public/ or emitted by this build: valid, and written in the
        // public-root style in the manifest.
        const output = toPublicOutput(`/${res}`)
        pushResource(matches, output, extra)

        return
      }

      // Written as a public/ or root path, the file belongs in public/, and
      // a dev session says so the way a build does.
      if (
        isPublicRootLike(written) &&
        !unixify(res).split('/').includes('..')
      ) {
        const warn = new WebpackError(
          warMessages.warFieldError(
            unixify(path.relative(projectPath, publicAbsMaybe)),
            {publicRootHint: true, relativeRef: written}
          )
        ) as Error & {file?: string; name?: string}
        warn.file = 'manifest.json'
        warn.name = 'WARRelativeAssetMissing'
        compilation.warnings.push(warn)

        return
      }

      // The manifest path was already rewritten to its output extension; if the
      // original source exists, say so: WAR entries are copied, not compiled.
      const sourceSibling = findSourceSibling(abs)

      // Warn only when the path is neither in public/ nor emitted. The entry is
      // left out of the manifest: keeping it moves the failure to runtime.
      const msg = warMessages.warFieldError(
        unixify(path.relative(projectPath, abs)),
        {
          relativeRef: res,
          sourceSibling: sourceSibling
            ? path.relative(manifestDir, sourceSibling)
            : undefined
        }
      )
      const warn = new WebpackError(msg) as Error & {
        file?: string
        name?: string
      }
      warn.file = 'manifest.json'
      warn.name = 'WARRelativeAssetMissing'
      compilation.warnings.push(warn)

      return
    }

    // A directory entry (e.g. `icons/`), emit its files and declare a glob so
    // Chrome serves them all, instead of reading the directory as a file (EISDIR).
    if (fs.statSync(abs).isDirectory()) {
      emitDirectoryAsAssets(
        compilation,
        abs,
        manifestDir,
        mayShipWalked,
        reportWithheldInside
      )

      const dirResource = `${unixify(res).replace(/\/+$/, '')}/*`
      pushResource(matches, dirResource, extra)

      return
    }

    // Emit the file AT ITS MANIFEST-RELATIVE PATH and declare that same path: WAR
    // resources are addressed by literal path, so flattening/hashing breaks lookups.
    const relOut = unixify(path.relative(manifestDir, abs))

    if (!relOut.startsWith('..')) {
      if (!compilation.getAsset(relOut)) {
        emitCopy(
          compilation,
          relOut,
          new sources.RawSource(
            templateCopiedAsset(compilation, relOut, fs.readFileSync(abs))
          )
        )
      }

      compilation.fileDependencies.add(abs)
      pushResource(matches, relOut, extra)

      return
    }

    // Outside the manifest root there is no extension-relative path the file
    // could be served at, keep the legacy assets/ emit for that edge.
    const emitted = emitFileAsAsset(compilation, abs)
    pushResource(matches, emitted, extra)
  }

  war.forEach((entry) => {
    if (typeof entry === 'string') {
      if (isMv2) handleOne(undefined, entry)

      return
    }

    if (!entry || typeof entry !== 'object') return

    const matches = entry.matches || []

    if (!Array.isArray(entry.resources)) return

    const {resources: _resources, matches: _matches, ...extra} = entry
    const extraFields = Object.keys(extra).length > 0 ? extra : undefined

    authorGroupHasNoMatches = entry.matches === undefined

    for (const res of entry.resources) handleOne(matches, res, extraFields)

    authorGroupHasNoMatches = false
  })

  warnCopiedSheetsWithUnshippedTargets(compilation)

  return {v2, v3}
}
