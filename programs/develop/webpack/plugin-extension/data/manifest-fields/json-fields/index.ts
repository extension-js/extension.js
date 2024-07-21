import {declarativeNetRequest} from './declarative_net_request'
import {storage} from './storage'
import {type Manifest} from '../../../../types'

export function jsonFields(
  context: string,

  manifest: Manifest
): Record<string, string | undefined> {
  return {
    // read as: declarativeNetRequest/<id>: declarativeNetRequest(manifestPath, manifest),
    ...declarativeNetRequest(context, manifest),
    'storage/managed_schema': storage(context, manifest)
  }
}
