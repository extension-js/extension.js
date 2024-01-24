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

export function getFilepath(feature: string, filePath: string) {
  const entryExt = path.extname(filePath)
  const entryName = path.basename(filePath, entryExt)
  const extname = getOutputExtname(entryExt)

  if (extname === '.html') {
    return `${feature}/index${extname}`
  }

  if (feature.startsWith('content_scripts')) {
    const [featureName, index] = feature.split('-')
    return `${featureName}/script-${index}${extname}`
  }

  if (
    extname.endsWith('.js') ||
    extname.endsWith('.jsx') ||
    extname.endsWith('.ts') ||
    extname.endsWith('.tsx') ||
    extname.endsWith('.mjs')
  ) {
    return `${feature}/script${extname}`
  }

  return `${feature}/${entryName}${extname}`
}
