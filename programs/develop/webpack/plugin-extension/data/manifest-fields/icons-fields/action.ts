import * as path from 'path'
import {type Manifest} from '../../../../webpack-types'

export function action(
  context: string,

  manifest: Manifest
): string | string[] | undefined {
  if (!manifest || !manifest.action || !manifest.action.default_icon) {
    return undefined
  }

  if (typeof manifest.action.default_icon === 'string') {
    return path.join(context, manifest.action.default_icon as string)
  }

  const actionDefaultIcons: string[] = []

  for (const icon in manifest.action.default_icon) {
    actionDefaultIcons.push(
      path.join(context, manifest.action.default_icon[icon] as string)
    )
  }

  return actionDefaultIcons
}
