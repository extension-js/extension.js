import path from 'path'
// import manifestFields from 'browser-extension-manifest-fields'

export default function resolvePath(
  context: string,
  relativePath: string
): string {
  // If URL, return as is
  if (relativePath.startsWith('http')) {
    return relativePath
  }

  // Build the absolute path of the public folder
  const publicDir = path.resolve(context, 'public')

  // Build the absolute path of the pages folder
  const pagesDir = path.resolve(context, 'pages')

  // Resolve the absolute path of the file
  const absolutePath = path.resolve(context, relativePath)

  // Check if the file is within the public directory
  if (absolutePath.startsWith(publicDir)) {
    // Return path relative to public folder
    const relativeToPublic = path.relative(publicDir, absolutePath)
    return `/public/${relativeToPublic}`
  } else if (absolutePath.startsWith(pagesDir)) {
    // Return path relative to pages folder
    const relativeToPages = path.relative(pagesDir, absolutePath)
    const featureName = path.basename(relativeToPages).startsWith('index')
      ? path.basename(path.dirname(relativeToPages))
      : path.basename(relativeToPages)

    return `/pages/${featureName}/index.html`
  } else {
    // TODO: Support manifest.json fields
    // if (path_is_equal_to_some_manifest_field) {
      // return `/[feature]/[index|script][ext]`
    // }

    return absolutePath
  }
}
