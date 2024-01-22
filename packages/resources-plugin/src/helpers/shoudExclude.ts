import path from 'path'

export default function shouldExclude(
  manifestPath: string,
  filepath: string,
  excludedFolders?: string[]
) {
  const manifestDir = path.dirname(manifestPath)
  const resolvedFilePath = path.resolve(manifestDir, filepath)

  return (
    excludedFolders?.some((excludePath) => {
      const resolvedExcludePath = path.resolve(manifestDir, excludePath)
      return resolvedFilePath.startsWith(resolvedExcludePath)
    }) ?? false
  )
}
