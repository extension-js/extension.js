// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {type Manifest} from '../../../../../webpack-types'

function patchWebResourcesV2(manifest: Manifest) {
  const defaultResources = [
    '/*.json',
    '/*.js',
    '/*.css',
    '/*.scss',
    '/*.sass',
    '/*.less',
    '*.styl',
    // HMR updates live under /hot/
    '/hot/*',
    // Common asset types for content scripts in MAIN world
    '/*.png',
    '/*.jpg',
    '/*.jpeg',
    '/*.svg',
    '/*.gif',
    '/*.webp',
    '/*.ico',
    '/*.avif'
  ]
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
  const defaultResources = [
    '/*.json',
    '/*.js',
    '/*.css',
    '/*.scss',
    '/*.sass',
    '/*.less',
    '*.styl',
    // HMR updates live under /hot/
    '/hot/*',
    // Common asset types for content scripts in MAIN world
    '/*.png',
    '/*.jpg',
    '/*.jpeg',
    '/*.svg',
    '/*.gif',
    '/*.webp',
    '/*.ico',
    '/*.avif'
  ]
  return [
    ...(manifest.web_accessible_resources || []),
    {
      resources: defaultResources,
      matches: ['<all_urls>']
    }
  ]
}

export {patchWebResourcesV2, patchWebResourcesV3}
