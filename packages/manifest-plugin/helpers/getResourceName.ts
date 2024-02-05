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

  if (feature.startsWith('content_scripts')) {
    const [featureName, index] = feature.split('-')
    return `${featureName}/script-${index}.js`
  }

  if (feature === 'service_worker') {
    return `background/${feature}.js`
  }

  if (feature === 'background') {
    return `${feature}/script${extname}.js`
  }

  if (feature === 'user_script') {
    return `${feature}/apiscript${extname}.js`
  }

  if (feature.startsWith('sandbox')) {
    const [featureName, index] = feature.split('-')
    return `${featureName}/page-${index}.html`
  }

  if (filePath.endsWith('html')) {
    return `${feature}/index.html`
  }

  return `${feature}/${entryName}${extname}`
}
