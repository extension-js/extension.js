// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {fetchExtensionFromStore} from 'extension-from-store'
import type {CompanionExtensionsConfig} from './types'
import {
  isDir,
  isFile,
  isValidExtensionRoot,
  normalizeCompanionConfig,
  toAbs
} from './utils'

type StoreBrowser = 'chrome' | 'edge' | 'firefox'

function isPathLike(value: string): boolean {
  if (path.isAbsolute(value)) return true
  if (value.startsWith('./') || value.startsWith('../')) return true

  return value.includes('/') || value.includes('\\')
}

function isSubpathOf(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function getBrowserFolder(browser: string | undefined): StoreBrowser {
  if (
    browser === 'firefox' ||
    browser === 'gecko-based' ||
    browser === 'firefox-based'
  ) {
    return 'firefox'
  }

  if (browser === 'edge') return 'edge'
  return 'chrome'
}

function parseChromeWebStoreId(url: URL): string | null {
  if (url.hostname !== 'chromewebstore.google.com') return null

  const match = url.pathname.match(/\/([a-z]{32})(?:\/|$)/i)

  return match ? match[1] : null
}

function parseEdgeAddonsId(url: URL): string | null {
  if (url.hostname !== 'microsoftedge.microsoft.com') return null

  const match = url.pathname.match(/\/([a-z]{32})(?:\/|$)/i)

  return match ? match[1] : null
}

function parseAmoSlug(url: URL): string | null {
  if (url.hostname !== 'addons.mozilla.org') return null

  const match = url.pathname.match(/\/addon\/([^/]+)(?:\/|$)/i)

  return match ? match[1] : null
}

function parseStoreUrl(
  raw: string
): {browser: StoreBrowser; id: string} | null {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const chromeId = parseChromeWebStoreId(url)
  if (chromeId) return {browser: 'chrome', id: chromeId}

  const edgeId = parseEdgeAddonsId(url)
  if (edgeId) return {browser: 'edge', id: edgeId}

  const amoSlug = parseAmoSlug(url)
  if (amoSlug) return {browser: 'firefox', id: amoSlug}

  return null
}

function ensurePathsUnderExtensions(
  projectRoot: string,
  paths: string[]
): string[] {
  const extensionsRoot = path.resolve(projectRoot, 'extensions')

  return paths.map((p) => {
    const abs = toAbs(projectRoot, p)

    if (
      abs !== extensionsRoot &&
      !isSubpathOf(extensionsRoot, abs) &&
      path.resolve(abs) !== extensionsRoot
    ) {
      throw new Error(
        `Companion extensions must be inside ${extensionsRoot}.\n` +
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
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'

  await fetchExtensionFromStore(url, {
    outDir,
    extract: true,
    logger: isAuthor
      ? {
          onInfo: (message) => console.log(message),
          onWarn: (message) => console.warn(message),
          onError: (message, error) => console.error(message, error)
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
    throw new Error(`Could not locate an unpacked extension from ${storeUrl}.`)
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
  const runtimeBrowser = getBrowserFolder(browser)
  const resolvedPaths: string[] = []
  const localPaths: string[] = []

  for (const entry of normalized.paths) {
    const parsedStore = parseStoreUrl(entry)
    if (parsedStore) {
      if (parsedStore.browser !== runtimeBrowser) {
        continue
      }

      const resolvedPath = await resolveStoreExtensionToPath({
        projectRoot,
        storeUrl: entry,
        browser: parsedStore.browser,
        id: parsedStore.id
      })

      resolvedPaths.push(resolvedPath)
      continue
    }

    if (isPathLike(entry)) {
      localPaths.push(entry)
    }
  }

  if (localPaths.length > 0) {
    const absLocalPaths = ensurePathsUnderExtensions(projectRoot, localPaths)
    resolvedPaths.push(...absLocalPaths)
  }

  const output: {dir?: string; paths?: string[]} = {}

  if (typeof normalized.dir === 'string') {
    const absDir = toAbs(projectRoot, normalized.dir)
    const extensionsRoot = path.resolve(projectRoot, 'extensions')

    if (absDir !== extensionsRoot && !isSubpathOf(extensionsRoot, absDir)) {
      throw new Error(
        `extensions.dir must be inside ${extensionsRoot}.\n` +
          `Invalid dir: ${absDir}`
      )
    }

    output.dir = normalized.dir
  }

  if (resolvedPaths.length > 0) output.paths = resolvedPaths

  return output
}
