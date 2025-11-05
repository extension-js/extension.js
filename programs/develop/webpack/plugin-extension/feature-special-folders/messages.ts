import colors from 'pintor'

export function serverRestartRequiredFromSpecialFolderMessageOnly(
  addingOrRemoving: string,
  folder: string,
  typeOfAsset: string
) {
  return (
    `${colors.red('ERROR')} in ${colors.yellow('manifest.json')} entrypoint: ` +
    `${addingOrRemoving} ${colors.yellow(typeOfAsset)} in ${colors.underline(
      folder + '/'
    )} requires a server restart.`
  )
}

export function publicContainsManifestError(absPath: string) {
  return (
    `${colors.red('ERROR')} Conflicting manifest.json in public/\n` +
    `Files under ${colors.yellow('public/')} are copied verbatim to the output and may overwrite generated assets.\n` +
    `Remove ${colors.yellow('public/manifest.json')} to avoid corrupting the packaged extension.\n\n` +
    `${colors.red('NOT ALLOWED')} ${colors.underline(absPath)}`
  )
}
