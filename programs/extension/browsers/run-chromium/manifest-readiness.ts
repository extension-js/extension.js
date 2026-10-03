// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readValidManifest(manifestPath: string): string | undefined {
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8')
    if (!content.trim()) return undefined

    JSON.parse(content)

    return content
  } catch {
    return undefined
  }
}

function normalizeManifestFile(filePath: unknown): string | undefined {
  if (typeof filePath !== 'string') return undefined

  const normalized = filePath.trim().replace(/^\/+/, '')
  if (!normalized) return undefined
  if (/^(https?:)?\/\//i.test(filePath)) return undefined
  if (/[*?[\]{}]/.test(normalized)) return undefined

  return normalized
}

function readStableFileSignature(filePath: string): string | undefined {
  try {
    const stats = fs.statSync(filePath)
    if (!stats.isFile()) return undefined

    return `${stats.size}:${stats.mtimeMs}`
  } catch {
    return undefined
  }
}

// A page reference may carry a fragment or a query the browser strips before
// it reads the file, so the file on disk is the part in front of them.
function normalizeManifestPage(pagePath: unknown): string | undefined {
  return typeof pagePath === 'string'
    ? normalizeManifestFile(pagePath.replace(/[?#].*$/, ''))
    : undefined
}

export type ManifestEngine = 'chromium' | 'gecko'

// Each engine reads its own background keys of a cross-browser manifest and
// ignores the rest, so a file only the other engine loads is never required.
function getBackgroundFiles(
  manifest: {manifest_version?: unknown; background?: BackgroundKeys},
  engine: ManifestEngine
): Array<string | undefined> {
  const background = manifest.background
  if (!background) return []

  const serviceWorker = normalizeManifestFile(background.service_worker)
  const documentFiles = [
    normalizeManifestPage(background.page),
    ...(Array.isArray(background.scripts)
      ? background.scripts.map(normalizeManifestFile)
      : [])
  ]
  const hasDocument = documentFiles.some(Boolean)

  if (engine === 'gecko') {
    return hasDocument ? documentFiles : [serviceWorker]
  }

  if (Number(manifest.manifest_version) >= 3) return [serviceWorker]

  return documentFiles
}

interface BackgroundKeys {
  service_worker?: unknown
  page?: unknown
  scripts?: unknown
}

function getManifestRequiredFiles(
  content: string,
  engine: ManifestEngine = 'chromium'
): string[] {
  try {
    const manifest = JSON.parse(content) as {
      manifest_version?: unknown
      background?: BackgroundKeys
      side_panel?: {default_path?: unknown}
      content_scripts?: Array<{js?: unknown; css?: unknown}>
    }

    const requiredFiles = new Set<string>()

    const addFile = (filePath: unknown) => {
      const normalized = normalizeManifestFile(filePath)
      if (normalized) requiredFiles.add(normalized)
    }

    for (const file of getBackgroundFiles(manifest, engine)) {
      if (file) requiredFiles.add(file)
    }

    const sidePanel = normalizeManifestPage(manifest.side_panel?.default_path)
    if (sidePanel) requiredFiles.add(sidePanel)

    if (Array.isArray(manifest.content_scripts)) {
      for (const contentScript of manifest.content_scripts) {
        if (Array.isArray(contentScript?.js)) {
          for (const jsFile of contentScript.js) addFile(jsFile)
        }

        if (Array.isArray(contentScript?.css)) {
          for (const cssFile of contentScript.css) addFile(cssFile)
        }
      }
    }

    return [...requiredFiles]
  } catch {
    return []
  }
}

// A built dist needs no stability wait, so this answers now rather than polling.
// Chromium refuses the whole extension for one missing entry file.
export function findMissingManifestFiles(
  outPath: string,
  engine: ManifestEngine = 'chromium'
): string[] {
  const content = readValidManifest(path.join(outPath, 'manifest.json'))
  if (!content) return []

  return getManifestRequiredFiles(content, engine).filter(
    (relativeFile) => !fs.existsSync(path.join(outPath, relativeFile))
  )
}

function hasRequiredManifestFiles(
  outPath: string,
  content: string,
  engine?: ManifestEngine
): boolean {
  const requiredFiles = getManifestRequiredFiles(content, engine)

  for (const relativeFile of requiredFiles) {
    if (!fs.existsSync(path.join(outPath, relativeFile))) {
      return false
    }
  }

  return true
}

export async function waitForStableManifest(
  outPath: string,
  options?: {
    timeoutMs?: number
    pollIntervalMs?: number
    stableReadsRequired?: number
    engine?: ManifestEngine
  }
) {
  const timeoutMs = options?.timeoutMs ?? 8000
  const pollIntervalMs = options?.pollIntervalMs ?? 150
  const stableReadsRequired = options?.stableReadsRequired ?? 2
  const manifestPath = path.join(outPath, 'manifest.json')
  const start = Date.now()
  let lastValidContent: string | undefined
  let stableReads = 0

  while (Date.now() - start < timeoutMs) {
    const currentContent = readValidManifest(manifestPath)

    if (
      currentContent &&
      hasRequiredManifestFiles(outPath, currentContent, options?.engine)
    ) {
      if (currentContent === lastValidContent) {
        stableReads += 1
      } else {
        lastValidContent = currentContent
        stableReads = 1
      }

      if (stableReads >= stableReadsRequired) {
        return true
      }
    } else {
      lastValidContent = undefined
      stableReads = 0
    }

    await sleep(pollIntervalMs)
  }

  return false
}

export async function waitForStableFiles(
  outPath: string,
  relativeFiles: string[],
  options?: {
    timeoutMs?: number
    pollIntervalMs?: number
    stableReadsRequired?: number
    engine?: ManifestEngine
  }
) {
  const files = Array.from(
    new Set(relativeFiles.map(normalizeManifestFile).filter(Boolean))
  ) as string[]

  if (files.length === 0) return true

  const timeoutMs = options?.timeoutMs ?? 8000
  const pollIntervalMs = options?.pollIntervalMs ?? 150
  const stableReadsRequired = options?.stableReadsRequired ?? 2
  const start = Date.now()
  let lastSignature = ''
  let stableReads = 0

  while (Date.now() - start < timeoutMs) {
    const currentSignatureParts: string[] = []
    let allFilesReady = true

    for (const relativeFile of files) {
      const absoluteFilePath = path.join(outPath, relativeFile)
      const fileSignature = readStableFileSignature(absoluteFilePath)

      if (!fileSignature) {
        allFilesReady = false
        break
      }

      currentSignatureParts.push(`${relativeFile}:${fileSignature}`)
    }

    if (allFilesReady) {
      const currentSignature = currentSignatureParts.sort().join('|')

      if (currentSignature === lastSignature) {
        stableReads += 1
      } else {
        lastSignature = currentSignature
        stableReads = 1
      }

      if (stableReads >= stableReadsRequired) {
        return true
      }
    } else {
      lastSignature = ''
      stableReads = 0
    }

    await sleep(pollIntervalMs)
  }

  return false
}

export async function waitForStableExtensionOutput(
  outPath: string,
  options?: {
    timeoutMs?: number
    pollIntervalMs?: number
    stableReadsRequired?: number
    engine?: ManifestEngine
  }
) {
  const manifestPath = path.join(outPath, 'manifest.json')
  const manifestReady = await waitForStableManifest(outPath, options)
  if (!manifestReady) return false

  const manifestContent = readValidManifest(manifestPath)
  if (!manifestContent) return false

  const requiredFiles = getManifestRequiredFiles(
    manifestContent,
    options?.engine
  )

  return waitForStableFiles(outPath, requiredFiles, options)
}
