import path from 'path'

export function getPublicPath(filePath: string) {
  const pathNormalized = path.normalize(filePath)
  const publicPath = pathNormalized.split('public/')[1]
  return `/public/${publicPath}`
}
