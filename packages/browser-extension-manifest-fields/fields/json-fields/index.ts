import {type ManifestData} from '../../types'
import declarativeNetRequest from './declarative_net_request'
import storage from './storage'

export default function getJsonFields(
  manifestPath: string,
  manifest: ManifestData
) {
  return {
    declarative_net_request: declarativeNetRequest(manifestPath, manifest),
    storage: storage(manifestPath, manifest)
  }
}
