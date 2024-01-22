import path from 'path'
import glob from 'glob'
import {type ManifestData} from '../../types'

export default function getWebAccessibleResources(
  manifestPath: string,
  manifest: ManifestData
): string[] | string[][] | undefined {
  if (
    !manifest ||
    !manifest.web_accessible_resources ||
    !manifest.web_accessible_resources.length
  ) {
    return undefined
  }
  const webAccessibleResources = []

  // Handle Manifest V3
  if (manifest.manifest_version === 3) {
    for (const entry of manifest.web_accessible_resources) {
      const resources: string[] = entry.resources || []

      const resourcesAbsolutePath = resources.map((resource) => {
        // If resource is a glob, we need to expand it
        if (resource.includes('*')) {
          const globPath = path.join(path.dirname(manifestPath), resource)
          const globPathResolved = glob.sync(globPath)
          return globPathResolved
        }

        const filePath = path.join(path.dirname(manifestPath), resource)
        return filePath
      })

      webAccessibleResources.push(resourcesAbsolutePath)
    }
  }

  // Handle Manifest V2
  if (manifest.manifest_version === 2) {
    const resourcesAbsolutePath = manifest.web_accessible_resources.map(
      (resource: string) => {
        if (resource.includes('*')) {
          const globPath = path.join(path.dirname(manifestPath), resource)
          const globPathResolved = glob.sync(globPath)
          return globPathResolved
        }

        return path.join(path.dirname(manifestPath), resource)
      }
    )

    webAccessibleResources.push(resourcesAbsolutePath)
  }

  return webAccessibleResources.flat().filter((arr) => arr.length > 0)
}
