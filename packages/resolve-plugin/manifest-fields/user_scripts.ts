import path from 'path'
import {type ManifestData} from '../resolver-module/types'

export default function userScripts(
  manifestPath: string,
  manifest: ManifestData
) {
  if (
    !manifest ||
    !manifest.user_scripts ||
    !manifest.user_scripts.api_script
  ) {
    return undefined
  }

  const userScript = manifest.user_scripts.api_script

  const scriptAbsolutePath = path.join(path.dirname(manifestPath), userScript)

  return scriptAbsolutePath
}
