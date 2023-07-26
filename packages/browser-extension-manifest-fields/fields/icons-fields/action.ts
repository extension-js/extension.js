import path from 'path'
import {type ManifestData} from '../../types'

export default function action(manifestPath: string, manifest: ManifestData) {
  if (!manifest || !manifest.action || !manifest.action.default_icon) {
    return undefined
  }

  if (typeof manifest.action.default_icon === 'string') {
    return path.join(path.dirname(manifestPath), manifest.action.default_icon)
  }

  const actionDefaultIcons = []

  for (const icon in manifest.action.default_icon) {
    const actionDefaultIconAbsolutePath = path.join(
      path.dirname(manifestPath),
      manifest.action.default_icon[icon]
    )

    actionDefaultIcons.push(actionDefaultIconAbsolutePath)
  }

  return actionDefaultIcons
}
