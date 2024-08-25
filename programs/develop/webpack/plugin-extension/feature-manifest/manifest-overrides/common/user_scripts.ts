import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../lib/utils'

export function userScripts(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.user_scripts && {
      user_scripts: {
        ...manifest.user_scripts,

        ...(manifest.user_scripts.api_script && {
          api_script: getFilename(
            'user_scripts/api_script.js',
            manifest.user_scripts.api_script as string,
            excludeList
          )
        })
      }
    }
  )
}
