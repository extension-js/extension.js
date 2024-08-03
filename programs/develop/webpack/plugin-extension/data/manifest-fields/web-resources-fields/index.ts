import {type Manifest} from '../../../../webpack-types'

export function webResourcesFields(
  manifest: Manifest
): Manifest['web_accessible_resources'] | undefined {
  if (
    !manifest ||
    !manifest.web_accessible_resources ||
    !manifest.web_accessible_resources.length
  ) {
    return undefined
  }

  return manifest.web_accessible_resources
}
