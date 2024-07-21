import path from 'path'
import {type Manifest} from '../../../../types'

type SandboxType = Record<string, string | undefined>

export function sandbox(context: string, manifest: Manifest): SandboxType {
  if (!manifest || !manifest.sandbox || !manifest.sandbox.pages) {
    return {[`sandbox/page-0`]: undefined}
  }

  const sandboxPages: string[] = manifest.sandbox.pages

  const sandboxedData: SandboxType = {}

  for (const [index, page] of sandboxPages.entries()) {
    sandboxedData[`sandbox/page-${index}`] = path.join(context, page)
  }

  return sandboxedData
}
