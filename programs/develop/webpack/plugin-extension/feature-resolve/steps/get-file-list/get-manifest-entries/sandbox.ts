import {type ManifestData} from './types.js'

export function sandbox(manifest: ManifestData) {
  if (!manifest || !manifest.sandbox || !manifest.sandbox.pages) {
    return {[`sandbox/page-0.html`]: undefined}
  }

  const sandboxPages = manifest.sandbox.pages as string[]

  const sandboxedData: Record<string, string> = {}

  for (const [index, page] of sandboxPages.entries()) {
    const sandboxPageAbsolutePath = page

    sandboxedData[`sandbox/page-${index}.html`] = sandboxPageAbsolutePath
  }

  return sandboxedData
}
