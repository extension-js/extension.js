import {type ManifestData} from './types.js'

export default function background(manifest: ManifestData) {
  if (!manifest || !manifest.background) {
    return undefined
  }

  const scripts: string[] = manifest.background.scripts

  if (scripts) {
    return scripts.map((script: string) => {
      const scriptAbsolutePath = script

      return scriptAbsolutePath
    })
  }

  return undefined
}
