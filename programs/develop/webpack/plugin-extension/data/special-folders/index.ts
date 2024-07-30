import path from 'path'
import {PluginInterface} from '../../../webpack-types'
import {scanFilesInFolder, generateEntries} from './generate-entries'

export function getSpecialFoldersData({manifestPath}: PluginInterface) {
  const projectPath = path.dirname(manifestPath)

  // Define special folders
  const folders = {
    public: path.join(projectPath, 'public'),
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
    pages: generateEntries(projectPath, allFiles.pages, 'pages', '.html'),
    scripts: generateEntries(projectPath, allFiles.scripts, 'scripts', '.js')
  }

  return entries
}
