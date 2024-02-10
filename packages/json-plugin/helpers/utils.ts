import path from 'path'

export function shouldExclude(path: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => {
    return path.includes(pattern)
  })
}

export function getExtname(filePath: string) {
  const extname = path.extname(filePath)

  switch (extname) {
    case '.js':
    case '.mjs':
    case '.ts':
    case '.tsx':
      return '.js'
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return '.css'
    case '.html':
      return '.html'
    default:
      return '.js'
  }
}
