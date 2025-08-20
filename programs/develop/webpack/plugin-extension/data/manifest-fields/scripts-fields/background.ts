import {resolveManifestPath} from '../normalize'
import {type Manifest} from '../../../../webpack-types'

export function backgroundScripts(
  context: string,
  manifest: Manifest
): string[] | undefined {
  if (!manifest || !manifest.background) {
    return undefined
  }

  const scripts = manifest.background.scripts

  if (scripts) {
    return scripts.map((script: string) => {
      return resolveManifestPath(context, script)
    })
  }

  return undefined
}
