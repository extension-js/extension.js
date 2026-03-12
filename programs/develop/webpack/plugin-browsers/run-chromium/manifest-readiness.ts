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

    if (currentContent) {
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
