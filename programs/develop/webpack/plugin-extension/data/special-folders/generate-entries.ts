import * as fs from 'fs'
import * as path from 'path'

export function scanFilesInFolder(
  dirPath: string,
  filter: (name: string) => boolean
): string[] {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return []
  }

  const files: string[] = []

  function recurse(currentPath: string) {
    const entries = fs.readdirSync(currentPath, {withFileTypes: true})

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        recurse(entryPath)
      } else if (entry.isFile() && filter(entry.name)) {
        files.push(entryPath)
      }
    }
  }

  recurse(dirPath)
  return files
}

type IncludeList = Record<string, string>

export function generateEntries(
  projectPath: string,
  includes: string[] | undefined,
  folderName: string = ''
): IncludeList {
  if (!includes || !includes.length) return {}

  return includes.reduce((acc, include) => {
    const extname = path.extname(include)

    // Special handling for pages/: preserve nested path and collapse "/index"
    if (folderName === 'pages') {
      const pagesRoot = path.join(projectPath, folderName)
      // Relative path inside pages/, normalized to unix style
      const rel = path.relative(pagesRoot, include).split(path.sep).join('/')

      // Strip extension
      let relNoExt = rel.slice(0, -extname.length)

      // Collapse nested "/index" -> its parent.
      // Root "index" remains "index"
      if (relNoExt.endsWith('/index')) {
        relNoExt = relNoExt.slice(0, -'/index'.length)
      }
      if (relNoExt === '') {
        relNoExt = 'index'
      }

      const key = `${folderName}/${relNoExt}`
      return {...acc, [key]: include}
    }

    // Default behavior (public/, scripts/, etc...)
    const filename = path.basename(include, extname)
    const key = folderName
      ? `${folderName}/${filename}`
      : path.relative(projectPath, include)

    return {
      ...acc,
      [key]: include
    }
  }, {})
}
