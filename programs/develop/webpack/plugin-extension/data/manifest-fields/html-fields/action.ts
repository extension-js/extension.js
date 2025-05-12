import * as path from 'path'
import {type Manifest} from '../../../../webpack-types'

export function action(
  context: string,
  manifest: Manifest
): string | undefined {
  if (!manifest || !manifest.action || !manifest.action.default_popup) {
    return undefined
  }

  const actionPage: string = manifest.action.default_popup

  return path.join(context, actionPage)
}
