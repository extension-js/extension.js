import path from 'path'

import {type Manifest} from '../../../../webpack-types'

export function background(
  context: string,
  manifest: Manifest
): string | undefined {
  // @ts-ignore
  if (!manifest || !manifest.background || !manifest.background.page) {
    return undefined
  }

  // @ts-ignore
  const backgroundPage: string = manifest.background.page

  return path.join(context, backgroundPage)
}
