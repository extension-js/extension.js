// Replaces the original node.js path module with a browser compatible version
// for the files we are resolving.

export function normalize(pathStr: string): string {
  const segments = pathStr.split('/').reduce((acc: string[], curr: string) => {
    if (curr === '..') {
      acc.pop()
    } else if (curr !== '.' && curr !== '') {
      acc.push(curr)
    }
    return acc
  }, [])

  return '/' + segments.join('/')
}

export function extname(pathStr: string): string {
  const base = basename(pathStr)
  const lastDot = base.lastIndexOf('.')

  if (lastDot === -1) return ''
  return base.substring(lastDot)
}

export function basename(pathStr: string, ext?: string): string {
  const base = pathStr.split('/').pop() || ''
  if (ext) {
    if (base.endsWith(ext)) {
      return base.substring(0, base.length - ext.length)
    }
  }
  return base
}

export function dirname(pathStr: string): string {
  const segments = pathStr.split('/')
  segments.pop()
  return segments.join('/') || '/'
}

export function relative(from: string, to: string): string {
  const fromSegments = from.split('/')
  const toSegments = to.split('/')

  while (fromSegments[0] === toSegments[0]) {
    fromSegments.shift()
    toSegments.shift()
  }

  return '../'.repeat(fromSegments.length) + toSegments.join('/')
}
