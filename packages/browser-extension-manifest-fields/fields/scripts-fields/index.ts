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
    background: backgroundScripts(manifestPath, manifest),
    service_worker: serviceWorker(manifestPath, manifest),
    ...contentScripts(manifestPath, manifest),
    user_scripts: userScripts(manifestPath, manifest)
  }
}
