import {type ManifestData} from '../../types'
import backgroundScripts from './background'
import contentScripts from './content_scripts'
import userScripts from './user_scripts'

export default function getScriptFields(
  manifestPath: string,
  manifest: ManifestData
) {
  return {
    background: backgroundScripts(manifestPath, manifest),
    ...contentScripts(manifestPath, manifest),
    userScripts: userScripts(manifestPath, manifest)
  }
}
