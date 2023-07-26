import path from 'path'
import {type ManifestData} from '../../types'

export default function declarativeNetRequest(
  manifestPath: string,
  manifest: ManifestData
): string[] | undefined {
  if (
    !manifest ||
    !manifest.declarative_net_request ||
    !manifest.declarative_net_request.rule_resources
  ) {
    return undefined
  }

  const declarativeNetRequest = manifest.declarative_net_request.rule_resources

  return declarativeNetRequest.map((resource: {path: string}) => {
    const declarativeNetRequestAbsolutePath = path.join(
      path.dirname(manifestPath),
      resource.path
    )

    return declarativeNetRequestAbsolutePath
  })
}
