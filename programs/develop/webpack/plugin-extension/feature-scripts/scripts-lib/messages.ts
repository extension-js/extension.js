import colors from 'pintor'

export function backgroundIsRequiredMessageOnly(backgroundChunkName: string) {
  return (
    '' +
    `Check the ${colors.yellow(backgroundChunkName.replace('/', '.'))} ` +
    `field in your ${colors.yellow('manifest.json')} file.`
  )
}


