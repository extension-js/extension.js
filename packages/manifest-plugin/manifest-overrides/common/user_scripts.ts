import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

export default function userScripts(manifest: Manifest, exclude: string[]) {
  return (
    manifest.user_scripts && {
      user_scripts: {
        ...manifest.user_scripts,

        ...(manifest.user_scripts.api_script && {
          api_script: getFilename(
            'user_scripts/api_script.js',
            manifest.user_scripts.api_script as string,
            exclude
          )
        })
      }
    }
  )
}
