// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {FilepathList, Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'

function normalizeOutputPath(originalPath: string) {
  if (!originalPath) return originalPath

  const unix = originalPath.replace(/\\/g, '/')

  // Preserve WAR glob patterns verbatim. Normalizing away a leading slash would
  // change the user's intended match from `/*.ext` to `*.ext`.
  if (/[*?[\]{}]/.test(unix)) {
    return unix
  }

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

  const mapResource = (resource: string) =>
    getFilename(normalizeOutputPath(resource), resource)

  // Handle each entry by its own shape rather than keying off the first
  // element: arrays mixing MV2 strings and MV3 objects must not crash here.
  // String entries in an MV3 manifest are rejected later (resolve-war) with
  // a proper compilation error; object entries without a resources array are
  // dropped as malformed.
  const entries = (
    manifest.web_accessible_resources as Array<
      | string
      | {
          resources?: string[]
          matches?: string[]
          extension_ids?: string[]
          use_dynamic_url?: boolean
        }
    >
  )
    .map((entry) => {
      if (typeof entry === 'string') {
        return mapResource(entry)
      }
      if (!entry || !Array.isArray(entry.resources)) {
        return undefined
      }
      return {
        ...entry,
        resources: entry.resources.map(mapResource)
      }
    })
    .filter((entry) => entry !== undefined)

  if (entries.length === 0) return undefined

  return {
    web_accessible_resources: entries as Manifest['web_accessible_resources']
  }
}
