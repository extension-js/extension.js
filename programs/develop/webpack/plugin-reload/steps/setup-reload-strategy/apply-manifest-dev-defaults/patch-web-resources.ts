import {type Manifest} from '../../../../../types'

function patchWebResourcesV2(manifest: Manifest) {
  const defaultResources = ['/*.json', '/*.js', '/*.css']
  const resources = manifest.web_accessible_resources as string[] | null

  if (!resources || resources.length === 0) {
    return defaultResources
  }

  const webResources = new Set(resources)

  for (const resource of defaultResources) {
    if (!webResources.has(resource)) {
      webResources.add(resource)
    }
  }

  return Array.from(webResources)
}

function patchWebResourcesV3(manifest: Manifest) {
  const defaultResources = ['/*.json', '/*.js', '/*.css']
  return [
    ...(manifest.web_accessible_resources || []),
    {
      resources: defaultResources,
      matches: ['<all_urls>']
    }
  ]
}

export {patchWebResourcesV2, patchWebResourcesV3}
