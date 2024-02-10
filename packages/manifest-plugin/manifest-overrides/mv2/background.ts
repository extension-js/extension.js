import {type Manifest} from '../../types'
import {shouldExclude} from '../../helpers/utils'

export default function background(manifest: Manifest, exclude: string[]) {
  return (
    manifest.background &&
    manifest.background.scripts && {
      background: {
        ...manifest.background,
        ...(manifest.background.scripts && {
          scripts: [
            'background/scripts.js',
            ...manifest.background.scripts.filter((script: string) =>
              shouldExclude(script, exclude)
            )
          ]
        })
      }
    }
  )
}
