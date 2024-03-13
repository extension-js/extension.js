import webpack from 'webpack'
import {bold, yellow} from '@colors/colors'
import {type ManifestBase} from '../manifest-types'
import {getManifestDocumentationURL} from '../helpers/getDocUrl'

export default function handleWrongWebResourceFormatError(
  manifest: ManifestBase,
  browser: string
): webpack.WebpackError | null {
  const webResources = manifest.web_accessible_resources as string[]

  if (webResources) {
    const mv2Format = webResources.some((resource: string) => {
      return typeof resource === 'string'
    })

    const mv3Format = webResources.some((resource: any) => {
      return (
        typeof resource === 'object' || resource.resources || resource.matches
      )
    })

    const namespace = yellow('web_accessible_resources')

    if (manifest.manifest_version === 2 && !mv2Format) {
      return new webpack.WebpackError(
        bold(
          `[manifest.json]: ${yellow(
            'web_accessible_resources'
          )} must be a string array in Manifest version 2.

Read more about using ${namespace} in the manifest file:
${getManifestDocumentationURL(browser)}`
        )
      )
    }

    if (manifest.manifest_version === 3 && !mv3Format) {
      return new webpack.WebpackError(
        bold(
          `[manifest.json]: ${yellow(
            'web_accessible_resources'
          )} must be an array of objects in Manifest version 3.

Read more about using ${namespace} in the manifest file:
${getManifestDocumentationURL(browser)}`
        )
      )
    }
  }

  return null
}
