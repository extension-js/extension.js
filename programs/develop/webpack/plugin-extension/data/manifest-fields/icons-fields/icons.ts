import path from 'path'
import {type Manifest} from '../../../../webpack-types'

export function icons(
  context: string,
  manifest: Manifest
): string[] | undefined {
  if (!manifest || !manifest.icons) return undefined

  const defaultIcons: string[] = []
  for (const icon in manifest.icons) {
    const iconAbsolutePath = path.join(context, manifest.icons[icon])

    defaultIcons.push(iconAbsolutePath)
  }

  return defaultIcons
}
