import {resolveManifestPath} from '../normalize'
import {type Manifest} from '../../../../webpack-types'

export function sandbox(
  context: string,
  manifest: Manifest
): Record<string, string | undefined> {
  if (!manifest || !manifest.sandbox || !manifest.sandbox.pages) {
    return {'sandbox/page-0': undefined}
  }

  const sandboxedData: Record<string, string | undefined> = {}

  for (const [index, page] of manifest.sandbox.pages.entries()) {
    sandboxedData[`sandbox/page-${index}`] = resolveManifestPath(context, page)
  }

  return sandboxedData
}
