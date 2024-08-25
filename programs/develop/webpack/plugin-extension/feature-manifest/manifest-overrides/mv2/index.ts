import {background} from './background'
import {browserAction} from './browser_action'
import {declarativeNetRequest} from './declarative_net_request'
import {type Manifest, type FilepathList} from '../../../../webpack-types'

export function manifestV2(manifest: Manifest, excludeList: FilepathList) {
  return {
    ...background(manifest, excludeList),
    ...browserAction(manifest, excludeList),
    ...declarativeNetRequest(manifest, excludeList)
  }
}
