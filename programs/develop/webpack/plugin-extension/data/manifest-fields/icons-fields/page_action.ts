import * as path from 'path'
import {type Manifest} from '../../../../webpack-types'

export function pageAction(
  context: string,
  manifest: Manifest
): string | string[] | undefined {
  if (
    !manifest ||
    !manifest.page_action ||
    !manifest.page_action.default_icon
  ) {
    return undefined
  }

  if (typeof manifest.page_action.default_icon === 'string') {
    return path.join(context, manifest.page_action.default_icon as string)
  }

  const pageActionDefaultIcons: string[] = []

  for (const icon in manifest.page_action.default_icon) {
    const pageactionDefaultIconAbsolutePath = path.join(
      context,
      manifest.page_action.default_icon[icon] as string
    )

    pageActionDefaultIcons.push(pageactionDefaultIconAbsolutePath)
  }

  return pageActionDefaultIcons
}
