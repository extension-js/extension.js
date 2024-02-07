import fs from 'fs'
import path from 'path'
import {getScriptResolveExtensions} from '../config/getPath'

export function scanHtmlFilesInFolder(dirPath: string): string[] {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return []
  }

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
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return []
  }

  let scriptFiles: string[] = []

  function recurse(currentPath: string) {
    const entries = fs.readdirSync(currentPath, {withFileTypes: true})

    for (const entry of entries) {
      const ext = path.extname(entry.name)
      const hasValidExt = getScriptResolveExtensions(projectPath).includes(ext)
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        recurse(entryPath)
      } else if (entry.isFile() && hasValidExt) {
        scriptFiles.push(entryPath)
      }
    }
  }

  recurse(dirPath)
  return scriptFiles
}

export function scanPublicFilesInFolder(dirPath: string): string[] {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return []
  }

  let publicFiles: string[] = []

  function recurse(currentPath: string) {
    const entries = fs.readdirSync(currentPath, {withFileTypes: true})

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        recurse(entryPath)
      } else if (entry.isFile()) {
        publicFiles.push(entryPath)
      }
    }
  }

  recurse(dirPath)
  return publicFiles
}

interface IncludeList {
  [key: string]: string
}

export function generatePagesEntries(
  includes: string[] | undefined
): IncludeList {
  if (!includes || !includes.length) return {}
  return includes.reduce((acc, include) => {
    const extname = path.extname(include)
    const basename = path.basename(include, extname)
    const entryname = basename === 'index' ? 'page' : basename

    return {
      ...acc,
      [`pages/${entryname}.html`]: include
    }
  }, {})
}

export function generateScriptsEntries(
  includes: string[] | undefined
): IncludeList {
  if (!includes || !includes.length) return {}
  return includes.reduce((acc, include) => {
    const extname = path.extname(include)
    const basename = path.basename(include, extname)
    const entryname = basename === 'index' ? 'script' : basename

    return {
      ...acc,
      [`scripts/${entryname}.js`]: include
    }
  }, {})
}

export function generatePublicEntries(
  projectPath: string,
  includes: string[] | undefined
): IncludeList {
  if (!includes || !includes.length) return {}
  return includes.reduce((acc, include) => {
    const relativePath = path.relative(projectPath, include)
    const publicPath = path.join('public', relativePath)

    return {
      ...acc,
      [publicPath]: include
    }
  }, {})
}
