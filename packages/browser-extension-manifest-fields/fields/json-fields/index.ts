import {type ManifestData} from '../../types'
import declarativeNetRequest from './declarative_net_request'
import storage from './storage'

export default function getJsonFields(
  manifestPath: string,
  manifest: ManifestData
) {
  return {
    'declarative_net_request/rule_resources': declarativeNetRequest(
      manifestPath,
      manifest
    ),
    'storage/managed_schema': storage(manifestPath, manifest)
  }
}
