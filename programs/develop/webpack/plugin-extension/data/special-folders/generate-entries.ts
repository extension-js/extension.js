import fs from 'fs'
import path from 'path'

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
  folderName: string = '',
  extension: string = ''
): IncludeList {
  if (!includes || !includes.length) return {}

  return includes.reduce((acc, include) => {
    const extname = path.extname(include)
    const filename = path.basename(include, extname)
    const key = folderName
      ? `${folderName}/${filename}${extension}`
      : path.relative(projectPath, include)

    return {
      ...acc,
      [key]: include
    }
  }, {})
}
