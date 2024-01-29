import path from 'path'
import {type ManifestData} from '../resolver-module/types'

export default function devtools(manifestPath: string, manifest: ManifestData) {
  if (!manifest || !manifest.devtools_page) {
    return undefined
  }

  const devtoolsPage = manifest.devtools_page

  const devtoolsAbsolutePath = path.join(
    path.dirname(manifestPath),
    devtoolsPage
  )

  return devtoolsAbsolutePath
}
