import path from 'path'

export default function shouldExclude(
  excludedFolders: string[],
  filePath: string
) {
  if (!excludedFolders || excludedFolders.length === 0) return false

  return excludedFolders.some((excludedFolder) => {
    const excludedFolderDir = path.basename(excludedFolder)

    return path.normalize(filePath).startsWith(excludedFolderDir)
  })
}
