import * as path from '../../helpers/pathUtils.js'

import {type ManifestData} from './types.js'

export default function devtools(manifest: ManifestData) {
  if (!manifest || !manifest.devtools_page) {
    return undefined
  }

  const devtoolsPage = manifest.devtools_page

  const devtoolsAbsolutePath = devtoolsPage

  return devtoolsAbsolutePath
}
