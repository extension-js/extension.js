// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

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
  if (
    !manifest.web_accessible_resources ||
    !manifest.web_accessible_resources.length
  ) {
    return undefined
  }

  // Support MV2 string[] and MV3 object[] formats
  if (
    Array.isArray(manifest.web_accessible_resources) &&
    typeof manifest.web_accessible_resources[0] === 'string'
  ) {
    return {
      web_accessible_resources: (
        manifest.web_accessible_resources as string[]
      ).map((resource: string) =>
        getFilename(normalizeOutputPath(resource), resource)
      )
    }
  }

  const v3 = (
    manifest.web_accessible_resources as Array<{
      resources?: string[]
      matches?: string[]
      extension_ids?: string[]
      use_dynamic_url?: boolean
    }>
  )
    .filter((entry) => Array.isArray(entry.resources))
    .map((entry) => ({
      ...entry,
      resources: (entry.resources || []).map((res) =>
        getFilename(normalizeOutputPath(res), res)
      )
    }))

  if (v3.length === 0) return undefined

  return {web_accessible_resources: v3}
}
