// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {fetchExtensionFromStore} from 'extension-from-store'
import {codedError} from '../coded-error'
import {
  companionLinkNotAStoreLinkError,
  unknownCompanionEntryError
} from '../extensions-to-load'
import * as messages from '../messages'
import {CODES, debugLine, isDebug, prefix} from '../messaging'
import {realPath} from '../real-path'
import type {CompanionExtensionsConfig} from './types'
import {
  companionFolderForBrowser,
  isDir,
  isFile,
  isValidExtensionRoot,
  normalizeCompanionConfig,
  toAbs
} from './utils'

type StoreBrowser = 'chrome' | 'edge' | 'firefox'

function isPathLike(value: string, projectRoot: string): boolean {
  if (path.isAbsolute(value)) return true
  if (value.startsWith('./') || value.startsWith('../')) return true
  if (value.includes('/') || value.includes('\\')) return true

  // A folder that is there is a folder, whatever its name looks like, a
  // store ID included.
  return value.trim().length > 0 && isDir(toAbs(projectRoot, value))
}

// The web store moved hosts; the old chrome.google.com/webstore links still
// name the same 32-character id.
function parseChromeWebStoreId(url: URL): string | null {
  const host = stripWww(url.hostname)
  const legacy =
    host === 'chrome.google.com' && /^\/webstore(?:\/|$)/i.test(url.pathname)
  if (host !== 'chromewebstore.google.com' && !legacy) return null

  const match = url.pathname.match(/\/([a-z]{32})(?:\/|$)/i)

  return match ? match[1] : null
}

function parseEdgeAddonsId(url: URL): string | null {
  if (stripWww(url.hostname) !== 'microsoftedge.microsoft.com') return null

  const match = url.pathname.match(/\/([a-z]{32})(?:\/|$)/i)

  return match ? match[1] : null
}

function parseAmoSlug(url: URL): string | null {
  if (stripWww(url.hostname) !== 'addons.mozilla.org') return null

  const match = url.pathname.match(/\/addon\/([^/]+)(?:\/|$)/i)

  return match ? match[1] : null
}

const STORE_HOSTS = new Set([
  'chromewebstore.google.com',
  'chrome.google.com',
  'microsoftedge.microsoft.com',
  'addons.mozilla.org'
])

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

// An entry is a link when it carries a web scheme, or when it starts with a
// store host and no scheme (the shape a pasted address bar often has).
function toWebUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url

    return null
  } catch {
    // Not an absolute URL; try the scheme-less store form below.
  }

  const match = raw.match(/^([a-z0-9.-]+)(?:[/?#].*)?$/i)
  if (!match || !STORE_HOSTS.has(stripWww(match[1]))) return null

  try {
    return new URL(`https://${raw}`)
  } catch {
    return null
  }
}

function parseStoreUrl(url: URL): {browser: StoreBrowser; id: string} | null {
  const chromeId = parseChromeWebStoreId(url)
  if (chromeId) return {browser: 'chrome', id: chromeId}

  const edgeId = parseEdgeAddonsId(url)
  if (edgeId) return {browser: 'edge', id: edgeId}

  const amoSlug = parseAmoSlug(url)
  if (amoSlug) return {browser: 'firefox', id: amoSlug}

  return null
}

// Whether an entry is a web link at all. One that is not may still be a
// folder path.
export function isCompanionWebLink(entry: string): boolean {
  return toWebUrl(entry) !== null
}

// Whether an entry is a link to an extension in a store this resolver reads:
// the Chrome Web Store, Edge Add-ons or Firefox Add-ons.
export function isCompanionStoreLink(entry: string): boolean {
  const url = toWebUrl(entry)

  return url !== null && parseStoreUrl(url) !== null
}

// Without a browser nothing is fetched, yet a link no store reads gets the
// refusal the launch path gives it, so preview and dev answer alike.
export function refuseCompanionLinksNoStoreReads(
  config?: CompanionExtensionsConfig
): void {
  for (const entry of normalizeCompanionConfig(config).paths) {
    const url = toWebUrl(entry)

    if (url && !parseStoreUrl(url)) throw companionLinkNotAStoreLinkError(entry)
  }
}

// A folder of the project, the project itself left out. Real paths are
// compared, so a link that leads out is outside like any other path.
function isInsideProject(projectRoot: string, abs: string): boolean {
  const relative = path.relative(realPath(projectRoot), realPath(abs))

  return !(
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
}

// A named folder may sit anywhere in the project.
function ensurePathsInsideProject(
  projectRoot: string,
  paths: string[]
): string[] {
  return paths.map((p) => {
    const abs = toAbs(projectRoot, p)

    if (!isInsideProject(projectRoot, abs)) {
      throw codedError(
        CODES.E_COMPANION_EXTENSION_PATH,
        'Companion extensions must be inside the project.\n' +
          `Invalid path: ${abs}`
      )
    }

    return abs
  })
}

function findExtensionRoots(dir: string, maxDepth = 3): string[] {
  const found: string[] = []

  function walk(current: string, depth: number) {
    if (depth > maxDepth) return
    if (!isDir(current)) return

    if (isValidExtensionRoot(current)) {
      found.push(current)

      return
    }

    let entries: fs.Dirent[] = []

    try {
      entries = fs.readdirSync(current, {withFileTypes: true})
    } catch {
      return
    }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      if (ent.name.startsWith('.')) continue

      walk(path.join(current, ent.name), depth + 1)
    }
  }

  walk(dir, 0)

  return found
}

async function runExtensionFromStore(url: string, outDir: string) {
  const isAuthor = isDebug()

  await fetchExtensionFromStore(url, {
    outDir,
    extract: true,
    logger: isAuthor
      ? {
          onInfo: (message) => debugLine(message),
          onWarn: (message) => debugLine(`${prefix('warn')} ${message}`),
          onError: (message, error) =>
            debugLine(`${prefix('error')} ${message}`, error)
        }
      : undefined
  })
}

async function resolveStoreExtensionToPath(opts: {
  projectRoot: string
  storeUrl: string
  browser: StoreBrowser
  id: string
}): Promise<string> {
  const {projectRoot, storeUrl, browser, id} = opts
  const extensionsRoot = path.resolve(projectRoot, 'extensions')
  const targetRoot = path.join(extensionsRoot, browser, id)
  const manifestPath = path.join(targetRoot, 'manifest.json')

  if (isFile(manifestPath)) return targetRoot

  await runExtensionFromStore(storeUrl, path.join(extensionsRoot, browser))
  const candidates = findExtensionRoots(path.join(extensionsRoot, browser))

  let selected: string | undefined

  if (candidates.length === 1) {
    selected = candidates[0]
  } else if (candidates.length > 1) {
    const directMatch = candidates.find((c) => path.basename(c) === id)
    const versionedMatch = candidates.find((c) =>
      path.basename(c).startsWith(`${id}@`)
    )

    if (directMatch) {
      selected = directMatch
    } else if (versionedMatch) {
      selected = versionedMatch
    }
  }

  if (!selected) {
    const folder = path
      .relative(projectRoot, path.join(extensionsRoot, browser))
      .split(path.sep)
      .join('/')
    const error = codedError(
      CODES.E_PROJECT_DOWNLOAD_EMPTY,
      messages.companionStoreDownloadEmpty(storeUrl, `${folder}/`)
    )
    error.name = 'CompanionStoreDownloadEmpty'

    throw error
  }

  fs.mkdirSync(path.dirname(targetRoot), {recursive: true})

  if (path.basename(selected).startsWith(`${id}@`)) {
    fs.renameSync(selected, targetRoot)
  }

  return targetRoot
}

export async function resolveCompanionExtensionsConfig(opts: {
  projectRoot: string
  browser: string
  config?: CompanionExtensionsConfig
}): Promise<CompanionExtensionsConfig | undefined> {
  const {projectRoot, browser, config} = opts
  if (!config) return undefined

  const normalized = normalizeCompanionConfig(config)
  const runtimeBrowser = companionFolderForBrowser(browser)
  const resolvedPaths: string[] = []
  const localPaths: string[] = []

  for (const entry of normalized.paths) {
    // Three outcomes: a store link (resolved, or skipped quietly when it
    // belongs to another browser), a folder path, or an entry that is
    // neither and is reported as such rather than diagnosed as a folder.
    const url = toWebUrl(entry)

    if (url) {
      const parsedStore = parseStoreUrl(url)

      if (!parsedStore) throw companionLinkNotAStoreLinkError(entry)

      if (parsedStore.browser !== runtimeBrowser) {
        continue
      }

      const resolvedPath = await resolveStoreExtensionToPath({
        projectRoot,
        storeUrl: url.href,
        browser: parsedStore.browser,
        id: parsedStore.id
      })

      resolvedPaths.push(resolvedPath)
      continue
    }

    if (isPathLike(entry, projectRoot)) {
      localPaths.push(entry)
      continue
    }

    throw unknownCompanionEntryError(entry)
  }

  if (localPaths.length > 0) {
    const absLocalPaths = ensurePathsInsideProject(projectRoot, localPaths)
    resolvedPaths.push(...absLocalPaths)
  }

  const output: {dir?: string; paths?: string[]} = {}

  if (typeof normalized.dir === 'string') {
    const absDir = toAbs(projectRoot, normalized.dir)

    // The scanned folder may sit anywhere in the project, like a named one.
    if (!isInsideProject(projectRoot, absDir)) {
      throw codedError(
        CODES.E_COMPANION_EXTENSION_PATH,
        'extensions.dir must be inside the project.\n' +
          `Invalid dir: ${absDir}`
      )
    }

    output.dir = normalized.dir
  }

  if (resolvedPaths.length > 0) output.paths = resolvedPaths

  return output
}
