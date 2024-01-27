import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function declarativeNetRequest(
  manifest: ManifestData,
  exclude: string[]
) {
  return (
    manifest.declarative_net_request && {
      declarative_net_request: {
        ...manifest.declarative_net_request,
        rule_resources: manifest.declarative_net_request.rule_resources.map(
          (resourceObj: {path: string}) => {
            return {
              ...resourceObj,
              path:
                resourceObj.path &&
                getFilename(
                  'declarative_net_request',
                  resourceObj.path,
                  exclude
                )
            }
          }
        )
      }
    }
  )
}
