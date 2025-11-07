import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../manifest-lib/paths'

export function userScripts(manifest: Manifest) {
  return (
    manifest.user_scripts && {
      user_scripts: {
        ...manifest.user_scripts,

        ...(manifest.user_scripts.api_script && {
          api_script: getFilename(
            'user_scripts/api_script.js',
            manifest.user_scripts.api_script as string
          )
        })
      }
    }
  )
}
