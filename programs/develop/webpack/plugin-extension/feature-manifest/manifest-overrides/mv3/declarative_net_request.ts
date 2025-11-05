import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'

export function declarativeNetRequest(
  manifest: Manifest,
  excludeList: FilepathList
) {
  return (
    manifest.declarative_net_request && {
      declarative_net_request: {
        ...manifest.declarative_net_request,
        rule_resources: manifest.declarative_net_request.rule_resources.map(
          (resourceObj: {path: string; id: string}) => {
            return {
              ...resourceObj,
              path:
                resourceObj.path &&
                getFilename(
                  `declarative_net_request/${resourceObj.id}.json`,
                  resourceObj.path,
                  excludeList
                )
            }
          }
        )
      }
    }
  )
}
