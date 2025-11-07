import {action} from './action'
import {backgroundServiceWorker} from './background'
import {declarativeNetRequest} from './declarative_net_request'
import {hostPermissions} from './host_permissions'
import {sidePanel} from './side_panel'
import {type Manifest} from '../../../../webpack-types'

export function manifestV3(manifest: Manifest) {
  return {
    ...action(manifest),
    ...backgroundServiceWorker(manifest),
    ...declarativeNetRequest(manifest),
    ...hostPermissions(manifest),
    ...sidePanel(manifest)
  }
}
