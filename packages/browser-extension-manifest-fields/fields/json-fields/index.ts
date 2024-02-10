import {type Manifest, type ManifestData} from '../../types'
import declarativeNetRequest from './declarative_net_request'
import storage from './storage'

export default function getJsonFields(
  manifestPath: string,
  manifest: Manifest
): {[key: string]: string | undefined} {
  return {
    // read as: declarativeNetRequest/<id>: declarativeNetRequest(manifestPath, manifest),
    ...declarativeNetRequest(manifestPath, manifest),
    'storage/managed_schema': storage(manifestPath, manifest)
  }
}
