import {type Manifest} from '../../../../webpack-types'

export function webAccessibleResources(manifest: Manifest) {
  return (
    manifest.web_accessible_resources &&
    manifest.web_accessible_resources.length && {
      web_accessible_resources: manifest.web_accessible_resources
    }
  )
}
