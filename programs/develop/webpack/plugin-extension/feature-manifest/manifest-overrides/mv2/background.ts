import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'

export function background(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.background &&
    manifest.background.scripts && {
      background: {
        ...manifest.background,
        ...(manifest.background.scripts && {
          scripts: [
            ...manifest.background.scripts.map((script) =>
              getFilename('background/scripts.js', script, excludeList)
            )
          ]
        })
      }
    }
  )
}
