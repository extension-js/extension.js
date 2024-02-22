import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type Manifest} from '../../types'

type SandboxType = Record<
  string,
  | {
      css: string[]
      js: string[]
      static: string[]
      html: string
    }
  | undefined
>

export default function sandbox(
  manifestPath: string,
  manifest: Manifest
): SandboxType {
  if (!manifest || !manifest.sandbox || !manifest.sandbox.pages) {
    return {[`sandbox/page-0`]: undefined}
  }

  const sandboxPages: string[] = manifest.sandbox.pages

  const sandboxedData: SandboxType = {}

  for (const [index, page] of sandboxPages.entries()) {
    const sandboxPageAbsolutePath = path.join(path.dirname(manifestPath), page)

    sandboxedData[`sandbox/page-${index}`] = getHtmlResources(
      sandboxPageAbsolutePath
    )
  }

  return sandboxedData
}
