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

export function getFilepath(feature: string) {
  if (feature.startsWith('content_scripts')) {
    const [featureName, index] = feature.split('-')
    return `${featureName}/script-${index}`
  }

  return `${feature}/script`
}
