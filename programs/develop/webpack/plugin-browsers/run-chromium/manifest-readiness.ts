// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'

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

function getManifestRequiredFiles(content: string): string[] {
  try {
    const manifest = JSON.parse(content) as {
      background?: {
        service_worker?: unknown
        page?: unknown
        scripts?: unknown
      }
      side_panel?: {default_path?: unknown}
      content_scripts?: Array<{js?: unknown; css?: unknown}>
    }

    const requiredFiles = new Set<string>()

    const addFile = (filePath: unknown) => {
      const normalized = normalizeManifestFile(filePath)
      if (normalized) requiredFiles.add(normalized)
    }

    addFile(manifest.background?.service_worker)
    addFile(manifest.background?.page)

    if (Array.isArray(manifest.background?.scripts)) {
      for (const script of manifest.background?.scripts || []) {
        addFile(script)
      }
    }

    addFile(manifest.side_panel?.default_path)

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

function hasRequiredManifestFiles(outPath: string, content: string): boolean {
  const requiredFiles = getManifestRequiredFiles(content)

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

    if (currentContent && hasRequiredManifestFiles(outPath, currentContent)) {
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
