import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type Manifest, ManifestHtmlData} from '../../types'

type SandboxType = {
  [key: string]:
    | {
        css: string[]
        js: string[]
        static: string[]
        html: string
      }
    | undefined
}

export default function sandbox(
  manifestPath: string,
  manifest: Manifest
): SandboxType {
  if (!manifest || !manifest.sandbox || !manifest.sandbox.pages) {
    return {[`sandbox/page-0`]: undefined}
  }

  const sandboxPages = manifest.sandbox.pages as string[]

  const sandboxedData: any = {}

  for (const [index, page] of sandboxPages.entries()) {
    const sandboxPageAbsolutePath = path.join(path.dirname(manifestPath), page)

    sandboxedData[`sandbox/page-${index}`] = getHtmlResources(
      sandboxPageAbsolutePath
    )
  }

  return sandboxedData
}
