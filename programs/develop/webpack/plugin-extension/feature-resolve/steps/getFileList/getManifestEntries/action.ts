import {type ManifestData} from './types.js'

export function action(manifest: ManifestData) {
  if (!manifest || !manifest.action || !manifest.action.default_popup) {
    return undefined
  }

  const actionPage = manifest.action.default_popup

  const actionPageAbsolutePath = actionPage

  return actionPageAbsolutePath
}
