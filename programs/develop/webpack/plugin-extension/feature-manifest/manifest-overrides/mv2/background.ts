import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../lib/utils'

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
