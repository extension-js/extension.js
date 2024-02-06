import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function userScripts(manifest: ManifestData, exclude: string[]) {
  return (
    manifest.user_scripts && {
      user_scripts: {
        ...manifest.user_scripts,

        ...(manifest.user_scripts.api_script && {
          api_script: getFilename('user_scripts', 'apiscript.js', exclude)
        })
      }
    }
  )
}
