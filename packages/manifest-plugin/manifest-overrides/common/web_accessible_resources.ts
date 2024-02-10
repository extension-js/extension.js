import {type Manifest} from '../../types'

export default function webAccessibleResources(
  manifest: Manifest,
  exclude: string[]
) {
  return (
    manifest.web_accessible_resources &&
    manifest.web_accessible_resources.length && {
      web_accessible_resources: manifest.web_accessible_resources
    }
  )
}
