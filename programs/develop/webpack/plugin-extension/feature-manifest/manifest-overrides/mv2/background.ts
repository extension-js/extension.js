import {type Manifest} from '../../../../webpack-types'

export function background(manifest: Manifest, exclude: string[]) {
  return (
    manifest.background &&
    manifest.background.scripts && {
      background: {
        ...manifest.background,
        ...(manifest.background.scripts && {
          scripts: [
            'background/scripts.js',
            ...manifest.background.scripts.filter((script: string) =>
              exclude.includes(script)
            )
          ]
        })
      }
    }
  )
}
