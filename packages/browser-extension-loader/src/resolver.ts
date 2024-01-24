import path from 'path'
import {
  assetAsManifestAsset,
  isManifestAsset,
  isPagesPath,
  isPublicPath
} from './utils'

function getPublicPath(context: string, absolutePath: string) {
  const publicDir = path.resolve(context, 'public')
  const relativeToPublic = path.relative(publicDir, absolutePath)

  return `/public/${relativeToPublic}`
}

function getPagesPath(context: string, absolutePath: string) {
  const pagesDir = path.resolve(context, 'pages')
  const relativeToPages = path.relative(pagesDir, absolutePath)
  const featureName = path.basename(relativeToPages).startsWith('index')
    ? path.basename(path.dirname(relativeToPages))
    : path.basename(relativeToPages)

  return `/pages/${featureName}/index.html`
}

function getManifestPath(
  context: string,
  absolutePath: string,
  relativePath: string
) {
  if (isManifestAsset(context, absolutePath)) {
    const assetPath = assetAsManifestAsset(context, absolutePath, relativePath)

    if (assetPath) {
      return assetPath
    }
  }

  return absolutePath
}

export default function resolvePath(
  context: string,
  relativePath: string
): string {
  // If URL, return as is
  if (relativePath.startsWith('http')) return relativePath

  // Resolve the absolute path of the file
  const absolutePath = path.resolve(context, relativePath)

  // Check if the file is within the public directory
  if (isPublicPath(context, absolutePath)) {
    return getPublicPath(context, absolutePath)

    // Check if the file is within the pages directory
  } else if (isPagesPath(context, absolutePath)) {
    return getPagesPath(context, absolutePath)

    // Check if the file is a manifest asset
  } else {
    if (isManifestAsset(context, absolutePath)) {
      return getManifestPath(context, absolutePath, relativePath)
    }

    return relativePath
  }
}
