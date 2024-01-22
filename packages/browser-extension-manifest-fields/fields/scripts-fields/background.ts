import path from 'path'
import {type ManifestData} from '../../types'

export default function background(
  manifestPath: string,
  manifest: ManifestData
) {
  if (!manifest || !manifest.background) {
    return undefined
  }

  const scripts: string[] = manifest.background.scripts

  if (scripts) {
    return scripts.map((script: string) => {
      const scriptAbsolutePath = path.join(path.dirname(manifestPath), script)

      return scriptAbsolutePath
    })
  }

  return undefined
}
