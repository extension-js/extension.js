import {action} from './action'
import {backgroundServiceWorker} from './background'
import {sidePanel} from './side_panel'
import {type Manifest} from '../../../../types'

export function manifestV3(manifest: Manifest, exclude: string[]) {
  return {
    ...action(manifest, exclude),
    ...backgroundServiceWorker(manifest, exclude),
    ...sidePanel(manifest, exclude)
  }
}
