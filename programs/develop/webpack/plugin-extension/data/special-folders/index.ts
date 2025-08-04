import * as fs from 'fs'
import * as path from 'path'
import {PluginInterface} from '../../../webpack-types'
import {scanFilesInFolder, generateEntries} from './generate-entries'

// Get the actual case-sensitive path of the public folder
// This handles the case where the folder might be named 'Public' on macOS but 'public' on Windows
function getPublicFolderPath(projectPath: string): string {
  const possibleNames = ['public', 'Public', 'PUBLIC']

  for (const name of possibleNames) {
    const folderPath = path.join(projectPath, name)
    if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
      return folderPath
    }
  }

  // Fallback to lowercase 'public' if no folder exists
  return path.join(projectPath, 'public')
}

export function getSpecialFoldersData({manifestPath}: PluginInterface) {
  const projectPath = path.dirname(manifestPath)

  // Define special folders with case-sensitive public folder detection
  const folders = {
    public: getPublicFolderPath(projectPath),
    pages: path.join(projectPath, 'pages'),
    scripts: path.join(projectPath, 'scripts')
  }

  // Scan files in each folder
  const allFiles = {
    public: scanFilesInFolder(folders.public, () => true),
    pages: scanFilesInFolder(folders.pages, (name) => name.endsWith('.html')),
    scripts: scanFilesInFolder(folders.scripts, (name) =>
      ['.js', '.mjs', '.jsx', '.mjsx', '.ts', '.mts', '.tsx', '.mtsx'].includes(
        path.extname(name)
      )
    )
  }

  // Generate entries for each folder
  const entries = {
    public: generateEntries(projectPath, allFiles.public),
    pages: generateEntries(projectPath, allFiles.pages, 'pages'),
    scripts: generateEntries(projectPath, allFiles.scripts, 'scripts')
  }

  return entries
}
