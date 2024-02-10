import path from 'path'
import {type Manifest, type ManifestData} from '../../types'

export default function icons(
  manifestPath: string,
  manifest: Manifest
): ManifestData {
  if (!manifest || !manifest.icons) return undefined

  const defaultIcons = []
  for (const icon in manifest.icons) {
    const iconAbsolutePath = path.join(
      path.dirname(manifestPath),
      manifest.icons[icon]
    )

    defaultIcons.push(iconAbsolutePath)
  }

  return defaultIcons
}
