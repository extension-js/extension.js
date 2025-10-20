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
