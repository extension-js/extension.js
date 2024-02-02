import fs from 'fs'
import path from 'path'
import {getScriptResolveExtensions} from '../config/getPath'

export function scanHtmlFilesInFolder(dirPath: string): string[] {
  let htmlFiles: string[] = []

  function recurse(currentPath: string) {
    const entries = fs.readdirSync(currentPath, {withFileTypes: true})

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        recurse(entryPath)
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        htmlFiles.push(entryPath)
      }
    }
  }

  recurse(dirPath)
  return htmlFiles
}

export function scanScriptFilesInFolder(
  projectPath: string,
  dirPath: string
): string[] {
  let htmlFiles: string[] = []

  function recurse(currentPath: string) {
    const entries = fs.readdirSync(currentPath, {withFileTypes: true})

    for (const entry of entries) {
      const ext = path.extname(entry.name)
      const hasValidExt = getScriptResolveExtensions(projectPath).includes(ext)
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        recurse(entryPath)
      } else if (entry.isFile() && hasValidExt) {
        htmlFiles.push(entryPath)
      }
    }
  }

  recurse(dirPath)
  return htmlFiles
}
