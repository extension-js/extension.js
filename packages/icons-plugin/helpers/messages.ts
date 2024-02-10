import webpack from 'webpack'

function entryNotFoundWarn(
  compilation: webpack.Compilation,
  feature: string,
  iconFilePath: string
) {
  const hintMessage = `Check the \`${feature}\` field in your \`manifest.json\` file.`
  const errorMessage = `File path \`${iconFilePath}\` not found. ${hintMessage}`

  compilation.warnings.push(
    new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
  )
}

export default {
  entryNotFoundWarn
}
