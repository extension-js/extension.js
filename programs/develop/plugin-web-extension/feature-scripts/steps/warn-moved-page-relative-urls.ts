// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, type Compiler, WebpackError} from '@rspack/core'
import type {FilepathList} from '../../../types'
import {keptPagePaths} from '../../shared/kept-page-paths'
import {unixify} from '../../shared/paths'
import {scannableSourcePath} from '../../shared/scannable-source-path'
import * as messages from '../messages'
import {blankComments} from './source-literals'
import {resolveExtensionPath} from './trace-runtime-loaded-files'

const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_REPORTED = 20

// src: "x" in a props object, el.src = "x", and src="x" or src={"x"} in JSX.
const URL_ATTRIBUTE_RE =
  /\b(?:src|href)["']?\s*[:=]\s*\{?\s*(["'])((?:(?!\1)[^\\\n])+)\1/g
const SET_ATTRIBUTE_RE =
  /\bsetAttribute\s*\(\s*["'](?:src|href)["']\s*,\s*(["'])((?:(?!\1)[^\\\n])+)\1/g

// The literal values a script gives a src or href, the way markup would.
export function extractUrlAttributeLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals = new Set<string>()

  for (const pattern of [URL_ATTRIBUTE_RE, SET_ATTRIBUTE_RE]) {
    for (const match of code.matchAll(pattern)) literals.add(match[2])
  }

  return [...literals]
}

interface MovedPageRelativeUrl {
  // The emitted page and the script of it that holds the literal.
  page: string
  assetName: string
  literal: string
  // Where the moved page asks for the file, and where the output holds it.
  requested: string
  emitted: string
}

interface MovedPage {
  // Both paths are relative to the extension root.
  source: string
  output: string
  scripts: Array<{assetName: string; text: string}>
}

// A page written in one folder and shipped in another keeps each relative
// path of its scripts, which now points beside the page's new place.
export function findMovedPageRelativeUrls(
  pages: MovedPage[],
  isShipped: (distRel: string) => boolean
): MovedPageRelativeUrl[] {
  const found: MovedPageRelativeUrl[] = []
  // Pages share chunks, so each script is read once for all of them.
  const literalsOf = new Map<string, string[]>()

  for (const page of pages) {
    if (path.posix.dirname(page.source) === path.posix.dirname(page.output)) {
      continue
    }

    const seen = new Set<string>()

    for (const {assetName, text} of page.scripts) {
      const literals =
        literalsOf.get(assetName) ?? extractUrlAttributeLiterals(text)
      literalsOf.set(assetName, literals)

      for (const literal of literals) {
        if (seen.has(literal)) continue

        const bare = literal.split(/[?#]/)[0]
        if (!/\.[A-Za-z0-9]{1,8}$/.test(bare)) continue

        const emitted = resolveExtensionPath(bare, page.source)
        const requested = resolveExtensionPath(bare, page.output)
        if (!emitted || !requested || emitted === requested) continue
        if (!isShipped(emitted) || isShipped(requested)) continue

        seen.add(literal)
        found.push({
          page: page.output,
          assetName,
          literal,
          requested,
          emitted
        })
      }
    }
  }

  return found
}

interface SourceModule {
  resource?: string
  modules?: Iterable<SourceModule>
}

// The project file that spells the literal, so the line names code the
// author can open and not a chunk the bundler named.
function findNamingSource(
  compilation: Compilation,
  literal: string
): string | undefined {
  for (const outer of compilation.modules as Iterable<SourceModule>) {
    for (const module of outer.modules ? [...outer.modules] : [outer]) {
      const resource = scannableSourcePath(module.resource)
      if (!resource) continue

      try {
        if (fs.statSync(resource).size > MAX_SOURCE_BYTES) continue

        const text = fs.readFileSync(resource, 'utf8')

        if (
          text.includes(literal) &&
          extractUrlAttributeLiterals(text).includes(literal)
        ) {
          return resource
        }
      } catch {
        // A module with no file on disk names nothing.
      }
    }
  }

  return undefined
}

// The module graph names a file by its real path while the project path may
// go through a symlink, so the label is tried against both spellings.
function projectRelative(projectPath: string, file: string) {
  const bases = [projectPath]

  try {
    bases.push(fs.realpathSync(projectPath))
  } catch {
    // Ignore
  }

  for (const base of bases) {
    const relative = unixify(path.relative(base, file))
    if (relative && !relative.startsWith('..')) return relative
  }

  return undefined
}

export class WarnMovedPageRelativeUrls {
  private readonly manifestPath: string
  private readonly pageList: FilepathList

  constructor(options: {manifestPath: string; pageList?: FilepathList}) {
    this.manifestPath = options.manifestPath
    this.pageList = options.pageList || {}
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      WarnMovedPageRelativeUrls.name,
      (compilation) => {
        compilation.hooks.afterProcessAssets.tap(
          WarnMovedPageRelativeUrls.name,
          () => this.report(compiler, compilation)
        )
      }
    )
  }

  private movedPages(compilation: Compilation): MovedPage[] {
    const manifestDir = path.dirname(this.manifestPath)
    const pages: MovedPage[] = []
    const kept = keptPagePaths(compilation)

    for (const [feature, value] of Object.entries(this.pageList)) {
      if (typeof value !== 'string' || !value) continue

      const source = unixify(path.relative(manifestDir, value))
      const output = `${feature}.html`
      if (source.startsWith('..')) continue
      if (path.posix.dirname(source) === path.posix.dirname(output)) continue
      // A page kept at its authored path asks from the folder it was written in.
      if (kept.has(output)) continue

      const files = compilation.entrypoints?.get?.(feature)?.getFiles?.() || []
      const scripts = files
        .filter((file) => /\.m?js$/i.test(file))
        .flatMap((file) => {
          const asset = compilation.getAsset(file)

          return asset
            ? [{assetName: unixify(file), text: String(asset.source.source())}]
            : []
        })

      if (scripts.length > 0) pages.push({source, output, scripts})
    }

    return pages
  }

  private report(compiler: Compiler, compilation: Compilation): void {
    try {
      const pages = this.movedPages(compilation)
      if (pages.length === 0) return

      const shipped = new Set(
        compilation.getAssets().map((asset) => unixify(asset.name))
      )
      const found = findMovedPageRelativeUrls(pages, (distRel) =>
        shipped.has(distRel)
      )
      const projectPath =
        (compiler.options.context as string) || path.dirname(this.manifestPath)

      for (const url of found.slice(0, MAX_REPORTED)) {
        const source = findNamingSource(compilation, url.literal)
        const label =
          (source && projectRelative(projectPath, source)) || url.assetName
        const warning = new WebpackError(
          messages.movedPageRelativeUrl(
            label,
            url.literal,
            url.page,
            url.requested,
            url.emitted
          )
        ) as Error & {file?: string}
        warning.name = 'MovedPageRelativeUrl'
        warning.file = label
        compilation.warnings.push(warning)
      }
    } catch {
      // Diagnostics only, never fail the compile over the scan
    }
  }
}
