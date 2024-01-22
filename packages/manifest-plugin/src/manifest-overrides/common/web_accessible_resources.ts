import {type ManifestData} from '../types'

export default function webAccessibleResources(
  manifest: ManifestData,
  exclude: string[]
) {
  return (
    manifest.web_accessible_resources &&
    manifest.web_accessible_resources.length && {
      web_accessible_resources: manifest.web_accessible_resources
    }
  )
}
