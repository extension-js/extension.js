import {getFilename} from '../../manifest-lib/paths'
import {type Manifest, type FilepathList} from '../../../../webpack-types'

function normalizeOutputPath(originalPath: string) {
  if (!originalPath) return originalPath

  const unix = originalPath.replace(/\\/g, '/')

  if (/^\/public\//i.test(unix)) {
    return unix.replace(/^\/public\//i, '')
  }

  if (/^(?:\.\/)?public\//i.test(unix)) {
    return unix.replace(/^(?:\.\/)?public\//i, '')
  }

  if (/^\//.test(unix)) {
    return unix.replace(/^\//, '')
  }

  return unix
}

export function webAccessibleResources(manifest: Manifest) {
  return (
    manifest.web_accessible_resources &&
    manifest.web_accessible_resources.length && {
      // Support MV2 string[] and MV3 object[] formats
      web_accessible_resources:
        Array.isArray(manifest.web_accessible_resources) &&
        typeof manifest.web_accessible_resources[0] === 'string'
          ? (manifest.web_accessible_resources as string[]).map(
              (resource: string) =>
                getFilename(normalizeOutputPath(resource), resource)
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
                getFilename(normalizeOutputPath(res), res)
              )
            }))
    }
  )
}
