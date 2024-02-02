import path from 'path'

export function isPage(manifestPath: string, filePath: string) {
  const projectDir = path.dirname(manifestPath)
  const relativePath = path.relative(projectDir, filePath)

  return relativePath.startsWith('pages/')
}

export function getPagePath(manifestPath: string, filePath: string) {
  const projectDir = path.dirname(manifestPath)
  const relativePath = path.relative(projectDir, filePath)
  const ext = path.extname(relativePath)
  const basename = path.basename(filePath, ext)

  const featureName =
    basename === 'index' ? path.basename(path.dirname(filePath), ext) : basename

  return `/pages/${featureName}/index.html`
}
