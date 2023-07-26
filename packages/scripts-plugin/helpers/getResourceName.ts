import path from 'path'

function getOutputExtname(extname: string) {
  switch (extname) {
    case '.css':
      return '.css'
    case '.js':
    case '.jsx':
    case '.ts':
    case '.tsx':
    case '.mjs':
      return '.js'
    case '.html':
      return extname
    case 'empty':
      return ''
    case 'static':
    case 'staticSrc':
    case 'staticHref':
    default:
      return extname
  }
}

export function getFilePathWithinFolder(feature: string, filePath: string) {
  const entryExt = path.extname(filePath)
  const entryName = path.basename(filePath, entryExt)
  const extname = getOutputExtname(entryExt)

  return `${feature}/${entryName}${extname}`
}

export function getFilePathSplitByDots(feature: string, filePath: string) {
  const entryExt = path.extname(filePath)
  const entryName = path.basename(filePath, entryExt)
  const extname = getOutputExtname(entryExt)

  return `${feature}.${entryName}${extname}`
}
