import path from 'path'
import {type Manifest} from '../../../../webpack-types'

export function devtoolsPage(
  context: string,

  manifest: Manifest
): string | undefined {
  if (!manifest || !manifest.devtools_page) {
    return undefined
  }

  const devtoolsPage: string = manifest.devtools_page

  return path.join(context, devtoolsPage)
}
