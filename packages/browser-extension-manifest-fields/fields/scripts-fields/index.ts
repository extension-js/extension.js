import {type ManifestData} from '../../types'
import backgroundScripts from './background'
import serviceWorker from './service_worker'
import contentScripts from './content_scripts'
import userScripts from './user_scripts'

export default function getScriptFields(
  manifestPath: string,
  manifest: ManifestData
) {
  return {
    'background/scripts': backgroundScripts(manifestPath, manifest),
    'background/service_worker': serviceWorker(manifestPath, manifest),
    ...contentScripts(manifestPath, manifest),
    'user_scripts/api_script': userScripts(manifestPath, manifest)
  }
}
