import {action} from './action'
import {backgroundServiceWorker} from './background'
import {declarativeNetRequest} from './declarative_net_request'
import {hostPermissions} from './host_permissions'
import {sidePanel} from './side_panel'
import {type Manifest, type FilepathList} from '../../../../webpack-types'

export function manifestV3(manifest: Manifest, excludeList: FilepathList) {
  return {
    ...action(manifest, excludeList),
    ...backgroundServiceWorker(manifest, excludeList),
    ...declarativeNetRequest(manifest, excludeList),
    ...hostPermissions(manifest),
    ...sidePanel(manifest, excludeList)
  }
}
