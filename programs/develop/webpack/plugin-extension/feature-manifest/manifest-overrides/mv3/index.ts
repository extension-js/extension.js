import {action} from './action'
import {backgroundServiceWorker} from './background'
import {sidePanel} from './side_panel'
import {type Manifest, type FilepathList} from '../../../../webpack-types'

export function manifestV3(manifest: Manifest, excludeList: FilepathList) {
  return {
    ...action(manifest, excludeList),
    ...backgroundServiceWorker(manifest, excludeList),
    ...sidePanel(manifest, excludeList)
  }
}
