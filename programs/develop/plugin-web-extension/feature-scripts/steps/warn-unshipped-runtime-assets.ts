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
import * as messages from '../messages'

const ASSET_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.wav',
  '.ogg',
  '.mp4',
  '.webm',
  '.json',
  '.txt',
  '.csv',
  '.wasm'
])

const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'public'])
const MAX_LITERAL_LENGTH = 200
const MAX_FOLDERS_REPORTED = 10

export interface RuntimePathReference {
  literal: string
  folder: string
  namePrefix: string
  file?: string
}

export interface UnshippedFolder {
  folder: string
  literal: string
  assetName: string
  missing: string[]
}

function hasAssetExtension(name: string): boolean {
  return ASSET_EXTENSIONS.has(path.posix.extname(name).toLowerCase())
}

function stripLeadingNavigation(literal: string): string {
  let rel = literal

  while (/^(?:\.{1,2}\/|\/)/.test(rel)) {
    rel = rel.replace(/^(?:\.{1,2}\/|\/)/, '')
  }

  return rel
}

// Quoted strings and template heads in emitted JS or HTML. A template head
// is the text before the first `${`, which is the folder part of the path.
export function extractPathLiterals(text: string): string[] {
  const found: string[] = []
  const quoted = /(["'])((?:(?!\1)[^\\\n\r])*)\1|`([^`\\$\n\r]*)(?:\$\{|`)/g

  for (const match of text.matchAll(quoted)) {
    const value = match[2] ?? match[3]

    if (value && value.length <= MAX_LITERAL_LENGTH) found.push(value)
  }

  return found
}

export function toRuntimePathReference(
  literal: string
): RuntimePathReference | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(literal)) return undefined
  if (!/^[\w@./-]+$/.test(literal)) return undefined

  const rel = stripLeadingNavigation(literal)
  if (!rel || rel.startsWith('.')) return undefined

  const segments = rel.split('/')

  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return undefined
  }

  if (SKIPPED_FOLDERS.has(segments[0])) return undefined

  const lastSlash = rel.lastIndexOf('/')
  const folder = lastSlash === -1 ? '' : rel.slice(0, lastSlash)
  const tail = rel.slice(lastSlash + 1)

  if (tail && hasAssetExtension(tail)) {
    return {literal, folder, namePrefix: tail, file: rel}
  }

  if (!folder) return undefined

  return {literal, folder, namePrefix: tail}
}

function listAssetFiles(dir: string, cache: Map<string, string[]>): string[] {
  const cached = cache.get(dir)
  if (cached) return cached

  let names: string[] = []

  try {
    names = fs
      .readdirSync(dir, {withFileTypes: true})
      .filter((entry) => entry.isFile() && hasAssetExtension(entry.name))
      .map((entry) => entry.name)
  } catch {
    names = []
  }

  cache.set(dir, names)

  return names
}

export function findUnshippedFolders(options: {
  extensionRoot: string
  sources: Array<{assetName: string; text: string}>
  isShipped: (distRel: string) => boolean
  isBundled: (absolutePath: string) => boolean
}): UnshippedFolder[] {
  const byFolder = new Map<string, UnshippedFolder>()
  const checked = new Set<string>()
  const listings = new Map<string, string[]>()

  for (const {assetName, text} of options.sources) {
    for (const literal of extractPathLiterals(text)) {
      const reference = toRuntimePathReference(literal)
      if (!reference) continue

      const key = `${reference.folder}\0${reference.file ?? reference.namePrefix}`
      if (checked.has(key)) continue

      checked.add(key)

      const folderPath = path.join(options.extensionRoot, reference.folder)
      const names = reference.file
        ? [path.posix.basename(reference.file)]
        : listAssetFiles(folderPath, listings).filter((name) =>
            name.startsWith(reference.namePrefix)
          )

      for (const name of names) {
        const distRel = reference.folder ? `${reference.folder}/${name}` : name
        const absolutePath = path.join(options.extensionRoot, distRel)

        if (!fs.existsSync(absolutePath)) continue
        if (!fs.statSync(absolutePath).isFile()) continue
        if (options.isShipped(distRel)) continue
        if (options.isBundled(absolutePath)) continue

        const entry = byFolder.get(reference.folder) ?? {
          folder: reference.folder,
          literal,
          assetName,
          missing: []
        }

        if (!entry.missing.includes(distRel)) entry.missing.push(distRel)

        byFolder.set(reference.folder, entry)
      }
    }
  }

  return foldNestedFolders([...byFolder.values()])
}

// Moving a folder to public/ moves its subfolders too, so a subfolder is
// reported inside the nearest reported folder above it.
function foldNestedFolders(entries: UnshippedFolder[]): UnshippedFolder[] {
  const sorted = [...entries].sort(
    (a, b) =>
      a.folder.length - b.folder.length || a.folder.localeCompare(b.folder)
  )
  const kept: UnshippedFolder[] = []

  for (const entry of sorted) {
    const parent = kept.find(
      (candidate) =>
        candidate.folder !== '' &&
        entry.folder.startsWith(`${candidate.folder}/`)
    )

    if (parent) parent.missing.push(...entry.missing)
    else kept.push(entry)
  }

  return kept.sort((a, b) => a.folder.localeCompare(b.folder))
}

function collectBundledFiles(compilation: Compilation): Set<string> {
  const bundled = new Set<string>()

  for (const file of compilation.fileDependencies) bundled.add(file)

  for (const module of compilation.modules) {
    const resource = (module as {resource?: string}).resource
    if (resource) bundled.add(resource.split('?')[0])
  }

  return bundled
}

// A path built or kept as a string at runtime is not traced, so its files
// stay out of the build. Name the folder and point to public/.
export class WarnUnshippedRuntimeAssets {
  public readonly manifestPath: string

  constructor(options: {manifestPath: string}) {
    this.manifestPath = options.manifestPath
  }

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.thisCompilation?.tap) return

    compiler.hooks.thisCompilation.tap(
      WarnUnshippedRuntimeAssets.name,
      (compilation) => {
        compilation.hooks.afterProcessAssets.tap(
          WarnUnshippedRuntimeAssets.name,
          () => this.report(compilation)
        )
      }
    )
  }

  private report(compilation: Compilation) {
    const extensionRoot = path.dirname(this.manifestPath)
    const shipped = new Set(
      compilation.getAssets().map((asset) => asset.name.replace(/\\/g, '/'))
    )
    let bundled: Set<string> | undefined

    const sources = compilation
      .getAssets()
      .filter((asset) => /\.(?:m?js|html?)$/i.test(asset.name))
      .map((asset) => ({
        assetName: asset.name.replace(/\\/g, '/'),
        text: asset.source.source().toString()
      }))

    const folders = findUnshippedFolders({
      extensionRoot,
      sources,
      isShipped: (distRel) => shipped.has(distRel),
      isBundled: (absolutePath) => {
        bundled ??= collectBundledFiles(compilation)

        return bundled.has(absolutePath)
      }
    })

    for (const folder of folders.slice(0, MAX_FOLDERS_REPORTED)) {
      const warning = new WebpackError(
        messages.runtimeAssetFolderNotShipped(
          folder.assetName,
          folder.literal,
          folder.folder,
          folder.missing
        )
      ) as Error & {file?: string}
      warning.name = 'RuntimeAssetFolderNotShipped'
      warning.file = folder.assetName
      compilation.warnings.push(warning)
    }
  }
}
