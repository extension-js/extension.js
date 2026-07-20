// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {type Compilation, sources, WebpackError} from '@rspack/core'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {normalizeManifestOutputPath} from '../../feature-manifest/normalize-manifest-path'
import {unixify} from '../../shared/paths'
import * as warMessages from './messages'

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

// A `web_accessible_resources` entry may name a whole directory (e.g. `icons/`),
// which Chrome serves as all files beneath it. Reading a directory as a file
// throws EISDIR (G15), so emit each contained file individually, preserving its
// path relative to the manifest so runtime references (`getURL('icons/x.png')`)
// keep resolving. The caller declares the directory as a `dir/*` glob resource.
function emitDirectoryAsAssets(
  compilation: Compilation,
  absDir: string,
  baseDir: string
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
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const outName = unixify(path.relative(baseDir, full))
      if (!compilation.getAsset(outName)) {
        compilation.emitAsset(
          outName,
          new sources.RawSource(fs.readFileSync(full))
        )
      }
      compilation.fileDependencies.add(full)
    }
  }
  walk(absDir)
}

function emitFileAsAsset(compilation: Compilation, absPath: string): string {
  // Content-hash in dev too: an unhashed `assets/[name][ext]` makes two assets
  // that merely share a basename overwrite each other (see plugin-static-assets).
  const filenamePattern = 'assets/[name].[contenthash:8][ext]'

  const ext = path.extname(absPath)
  const name = path.basename(absPath, ext)
  const content = fs.readFileSync(absPath)

  let outName = filenamePattern.replace('[name]', name).replace('[ext]', ext)

  if (outName.includes('[contenthash:8]')) {
    const hash = crypto
      .createHash('sha1')
      .update(content)
      .digest('hex')
      .slice(0, 8)
    outName = outName.replace('[contenthash:8]', hash)
  }

  if (!compilation.getAsset(outName)) {
    compilation.emitAsset(outName, new sources.RawSource(content))
  }

  compilation.fileDependencies.add(absPath)

  return unixify(outName)
}

// The manifest override rewrites source extensions to output extensions
// before resolution runs, so a missing `src/x.js` may really be `src/x.ts`
// on disk. Find that original so the warning can explain what happened.
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

function isValidChromeMatchPattern(pattern: string): boolean {
  // Special token is allowed by Chrome for WAR
  if (pattern === '<all_urls>') return true

  if (/[?#]/.test(pattern)) return false

  if (!pattern.endsWith('/*')) return false

  // Chrome loads WAR match patterns that carry a port, including the port
  // wildcard (`*://localhost:*/*`, verified against live Chrome). `:*` is
  // not URL-parseable, so normalize it to a concrete port before parsing.
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
  if (!matches || isFirefox(browser)) return
  compilation.errors ||= []

  for (const m of matches) {
    if (!isValidChromeMatchPattern(m)) {
      const msg = warMessages.warInvalidMatchPattern(m)
      const err = new WebpackError(msg) as Error & {
        file?: string
        name?: string
      }
      err.file = 'manifest.json'
      err.name = 'WARInvalidMatchPattern'
      compilation.errors!.push(err)
    }
  }
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
  }> = []

  const manifestObj = manifest as {
    manifest_version?: number
    web_accessible_resources?: unknown
    content_scripts?: unknown
  }
  const war = manifestObj.web_accessible_resources as
    | Array<string | {resources?: string[]; matches?: string[]}>
    | undefined

  if (!war) return {v2, v3}

  // String entries are the MV2 format. In an MV3 manifest they are invalid
  // (Chrome rejects the manifest at load time), so they become a build error
  // below instead of shipping. Detection is per entry, not via war[0].
  const isMv2 = manifestObj.manifest_version !== 3
  const manifestDir = path.dirname(manifestPath)
  const projectPath = (compilation.options?.context as string) || manifestDir

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
      group = {matches: matches || [], resources: new Set(), extra}
      v3.push(group)
    } else if (extra && !group.extra) {
      group.extra = extra
    }

    group.resources.add(resource)
  }

  const handleOne = (
    matches: string[] | undefined,
    res: string,
    extra?: Record<string, unknown>
  ) => {
    compilation.errors = compilation.errors || []
    compilation.warnings = compilation.warnings || []

    // Fast‑path: if this resource resolves to an actual file under the project
    // public/ folder, accept it and never warn. This keeps behavior aligned
    // with icons and manifest validation and avoids false negatives when
    // public assets exist but the output graph is not yet populated.
    const normalizedOutput = normalizeManifestOutputPath(res)
    const publicCandidate = path.join(projectPath, 'public', normalizedOutput)
    if (fs.existsSync(publicCandidate)) {
      pushResource(matches, normalizedOutput, extra)
      return
    }

    const absForExclude = path.isAbsolute(res)
      ? res
      : path.join(
          manifestDir,
          isPublicRootLike(res) ? toPublicOutput(res) : res
        )

    if (/[*?[\]{}]/.test(res)) {
      pushResource(matches, res, extra)
      return
    }

    if (isPublicRootLike(res)) {
      const output = normalizeManifestOutputPath(res)
      const publicAbs = path.join(projectPath, 'public', output)

      // Compute output root and see if the asset is already present in the build,
      // since leading '/' refers to the extension output root after build.
      const outputRoot =
        compilation.options?.output?.path ||
        compilation.outputOptions?.path ||
        path.join(path.dirname(manifestPath), 'dist')
      const builtAbs = path.join(outputRoot || '', output)

      const asset =
        typeof compilation.getAsset === 'function'
          ? compilation.getAsset(output)
          : undefined
      const assetEmitted =
        Boolean(asset && asset.name === output) || fs.existsSync(builtAbs)

      // In development, avoid noisy warnings for public-root WAR entries.
      // The dev server already watches public/ and surfaces 404s at runtime;
      // we keep strict validation for production builds only.
      const isDevMode =
        (compilation.options?.mode || 'development') !== 'production'

      if (process.env.EXTENSION_DEV_DEBUG_WAR === '1') {
        // eslint-disable-next-line no-console
        console.log(
          '[web-resources:resolve-war] public-like resource',
          JSON.stringify({
            res,
            output,
            projectPath,
            publicAbs,
            outputRoot,
            builtAbs,
            publicExists: fs.existsSync(publicAbs),
            builtExists: fs.existsSync(builtAbs),
            assetEmitted
          })
        )
      }

      if (!isDevMode && !fs.existsSync(publicAbs) && !assetEmitted) {
        const overrideNotFoundPath = builtAbs
        const msg = warMessages.warFieldError(publicAbs, {
          overrideNotFoundPath,
          publicRootHint: true,
          relativeRef: res
        })
        const err = new (
          WebpackError as unknown as {
            new (message: string): Error & {file?: string}
          }
        )(msg)
        err.file = 'manifest.json'

        compilation.warnings!.push(err)
      }

      pushResource(matches, output, extra)
      return
    }

    const abs = path.isAbsolute(res) ? res : path.join(manifestDir, res)
    if (!fs.existsSync(abs)) {
      // Also consider presence under public/ or already-emitted/built output root
      const outputRoot =
        compilation.options?.output?.path ||
        compilation.outputOptions?.path ||
        path.join(path.dirname(manifestPath), 'dist')
      const builtAbs = path.join(outputRoot || '', res)
      const publicAbsMaybe = path.join(projectPath, 'public', res)
      const asset2 =
        typeof (compilation as any).getAsset === 'function'
          ? (compilation as any).getAsset(res)
          : undefined
      const assetEmitted =
        Boolean(asset2 && (asset2 as any).name === res) ||
        fs.existsSync(builtAbs)

      if (fs.existsSync(publicAbsMaybe) || assetEmitted) {
        // Resource exists either under public/ or in the emitted output; treat
        // it as valid and normalize to the public-root style in the manifest.
        const output = toPublicOutput('/' + res)
        pushResource(matches, output, extra)
        return
      }

      // The manifest path was already rewritten to its output extension
      // (e.g. src/injected.ts became src/injected.js). If the original
      // source file exists, say so: WAR entries are copied, not compiled.
      const sourceSibling = findSourceSibling(abs)

      // Warn about missing relative path using standardized message only when
      // it does not exist in public/ and was not emitted to the output. The
      // entry is dropped from the emitted manifest: keeping a path that no
      // file will ever exist at just moves the failure to runtime.
      const msg = warMessages.warFieldError(abs, {
        relativeRef: res,
        sourceSibling: sourceSibling
          ? path.relative(manifestDir, sourceSibling)
          : undefined
      })
      const warn = new WebpackError(msg) as Error & {
        file?: string
        name?: string
      }
      warn.file = 'manifest.json'
      warn.name = 'WARRelativeAssetMissing'
      compilation.warnings!.push(warn)
      return
    }

    // A directory entry (e.g. `icons/`), emit its files and declare a glob so
    // Chrome serves them all, instead of reading the directory as a file (EISDIR).
    if (fs.statSync(abs).isDirectory()) {
      emitDirectoryAsAssets(compilation, abs, manifestDir)
      const dirResource = unixify(res).replace(/\/+$/, '') + '/*'
      pushResource(matches, dirResource, extra)
      return
    }

    // Emit the file AT ITS MANIFEST-RELATIVE PATH and declare that same path.
    // WAR resources are addressed at runtime by literal path,
    // chrome.runtime.getURL('adapters/chrome/content_module.js'), so the old
    // assets/<basename> flattening both broke those lookups (the declared
    // name no longer matched the requested path) and silently aliased
    // same-named files from different directories (ui/stats.js vs
    // storage/stats.js) to whichever was emitted first. Contenthash renaming
    // in production breaks the runtime address the same way, so the path is
    // preserved verbatim in every mode.
    const relOut = unixify(path.relative(manifestDir, abs))
    if (!relOut.startsWith('..')) {
      if (!compilation.getAsset(relOut)) {
        compilation.emitAsset(
          relOut,
          new sources.RawSource(fs.readFileSync(abs))
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
      if (isMv2) {
        handleOne(undefined, entry)
        return
      }

      const msg = warMessages.warStringEntryInMv3(entry)
      const err = new WebpackError(msg) as Error & {
        file?: string
        name?: string
      }
      err.file = 'manifest.json'
      err.name = 'WARStringEntryInMv3'
      compilation.errors = compilation.errors || []
      compilation.errors.push(err)
      return
    }

    if (!entry || typeof entry !== 'object') return

    const matches = entry.matches || []

    validateMatchesOrReport(compilation, matches, browser)

    if (!Array.isArray(entry.resources)) return

    const {resources: _resources, matches: _matches, ...extra} = entry
    const extraFields = Object.keys(extra).length > 0 ? extra : undefined

    entry.resources.forEach((res) => handleOne(matches, res, extraFields))
  })

  return {v2, v3}
}
