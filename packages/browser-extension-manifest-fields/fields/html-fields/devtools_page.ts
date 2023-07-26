import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type ManifestData} from '../../types'

export default function devtools(manifestPath: string, manifest: ManifestData) {
  if (!manifest || !manifest.devtools_page) {
    return undefined
  }

  const devtoolsPage = manifest.devtools_page

  const devtoolsAbsolutePath = path.join(
    path.dirname(manifestPath),
    devtoolsPage
  )

  return getHtmlResources(devtoolsAbsolutePath)
}
