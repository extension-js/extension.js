import path from 'path'
import {type Manifest} from '../../../../types'

export function declarativeNetRequest(
  context: string,
  manifest: Manifest
): Record<string, string | undefined> {
  const ruleResources: Record<string, string> = {}

  if (
    !manifest ||
    !manifest.declarative_net_request ||
    !manifest.declarative_net_request.rule_resources
  ) {
    return {'declarative_net_request/rule_resources-0': undefined}
  }

  const declarativeNetRequest: Record<string, any> =
    manifest.declarative_net_request.rule_resources

  declarativeNetRequest.forEach((resource: {id: string; path: string}) => {
    ruleResources[`declarative_net_request/${resource.id}`] = path.join(
      context,
      resource.path
    )
  })

  return ruleResources
}
