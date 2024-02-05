function patchWebResourcesV2(manifest: Record<string, any>) {
  const defaultResources = ['/*.json', '/*.js', '/*.css']
  const resources: string[] | null = manifest.web_accessible_resources

  if (!resources || resources.length === 0) {
    return defaultResources
  }

  const webResources = new Set(resources)

  for (const resource of defaultResources) {
    webResources.add(resource)
  }

  return Array.from(webResources)
}

interface ResourceEntry {
  resources: string[]
  matches: string[]
}

function patchWebResourcesV3(manifest: any) {
  const defaultResources = ['/*.json', '/*.js', '/*.css']
  const resources: ResourceEntry[] | null = manifest.web_accessible_resources

  if (!resources || resources.length === 0) {
    return [
      {
        resources: defaultResources,
        matches: ['<all_urls>']
      }
    ]
  }

  const updatedResources = resources.map((entry) => {
    const resourceSet = new Set(entry.resources)

    defaultResources.forEach((resource) => {
      if (entry && entry.resources) {
        if (!entry.resources.includes(resource)) {
          resourceSet.add(resource)
        }
      }
    })

    return {...entry, resources: Array.from(resourceSet)}
  })

  return updatedResources
}

export {patchWebResourcesV2, patchWebResourcesV3}
