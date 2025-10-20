import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../../develop-lib/utils'

export function webAccessibleResources(
  manifest: Manifest,
  excludeList: FilepathList
) {
  return (
    manifest.web_accessible_resources &&
    manifest.web_accessible_resources.length && {
      // Support MV2 string[] and MV3 object[] formats
      web_accessible_resources:
        Array.isArray(manifest.web_accessible_resources) &&
        typeof manifest.web_accessible_resources[0] === 'string'
          ? (manifest.web_accessible_resources as string[]).map(
              (resource: string) =>
                // Preserve the intended output path; do not force a
                // web_accessible_resources/ prefix
                getFilename(resource, resource, excludeList)
            )
          : (
              manifest.web_accessible_resources as Array<{
                resources: string[]
                matches?: string[]
                extension_ids?: string[]
                use_dynamic_url?: boolean
              }>
            ).map((entry) => ({
              ...entry,
              resources: entry.resources.map((res) =>
                // Preserve the intended output path; do not force a
                // web_accessible_resources/ prefix
                getFilename(res, res, excludeList)
              )
            }))
    }
  )
}
