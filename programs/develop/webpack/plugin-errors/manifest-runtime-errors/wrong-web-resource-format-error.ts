import webpack from 'webpack'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'
import {DevOptions} from '../../../module'

export function wrongWebResourceFormatError(
  manifest: Manifest,
  browser: DevOptions['browser']
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

    if (manifest.manifest_version === 2 && !mv2Format) {
      return new webpack.WebpackError(
        messages.webAccessibleResourcesV2Type(browser)
      )
    }

    if (manifest.manifest_version === 3 && !mv3Format) {
      return new webpack.WebpackError(
        messages.webAccessibleResourcesV3Type(browser)
      )
    }
  }

  return null
}
