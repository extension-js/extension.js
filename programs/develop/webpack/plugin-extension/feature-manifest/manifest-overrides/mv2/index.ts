import {background} from './background'
import {browserAction} from './browser_action'
import {declarativeNetRequest} from './declarative_net_request'
import {type Manifest} from '../../../../types'

export function manifestV2(manifest: Manifest, exclude: string[]) {
  return {
    ...background(manifest, exclude),
    ...browserAction(manifest, exclude),
    ...declarativeNetRequest(manifest, exclude)
  }
}
