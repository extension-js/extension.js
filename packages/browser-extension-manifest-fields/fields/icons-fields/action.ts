import path from 'path'
import {type Manifest, type ManifestData} from '../../types'

export default function action(
  manifestPath: string,
  manifest: Manifest
): ManifestData {
  if (!manifest || !manifest.action || !manifest.action.default_icon) {
    return undefined
  }

  if (typeof manifest.action.default_icon === 'string') {
    return path.join(
      path.dirname(manifestPath),
      manifest.action.default_icon as string
    )
  }

  const actionDefaultIcons: string[] = []

  for (const icon in manifest.action.default_icon) {
    const actionDefaultIconAbsolutePath = path.join(
      path.dirname(manifestPath),
      manifest.action.default_icon[icon] as string
    )

    actionDefaultIcons.push(actionDefaultIconAbsolutePath)
  }

  return actionDefaultIcons
}
