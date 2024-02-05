import action from './action'
import background from './background'
import sidePanel from './side_panel'
import {type ManifestData} from '../types'

export default function manifestV3(manifest: ManifestData, exclude: string[]) {
  return {
    ...action(manifest, exclude),
    ...background(manifest, exclude),
    ...sidePanel(manifest, exclude)
  }
}
