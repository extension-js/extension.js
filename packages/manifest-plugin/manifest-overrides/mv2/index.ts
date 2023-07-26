import background from './background'
import browserAction from './browser_action'
import declarativeNetRequest from './declarative_net_request'
import {type ManifestData} from '../types'
// import getFilename from '../getFilename'

export default function manifestV2(manifest: ManifestData, exclude: string[]) {
  return {
    ...background(manifest, exclude),
    ...browserAction(manifest, exclude),
    ...declarativeNetRequest(manifest, exclude)
  }
}
