import {type Manifest} from '../../../../webpack-types'

export default function patchExternallyConnectable(manifest: Manifest) {
  // If the externally_connectable key is not declared in your extension's
  // manifest, all extensions can connect, but no web pages can connect.
  // As a consequence, when updating your manifest to use externally_connectable,
  // if "ids": ["*"] is not specified, then other extensions will lose the ability
  // to connect to your extension. This may be an unintended consequence, so keep it in mind.
  // See https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable
  if (!manifest.externally_connectable) {
    return {}
  }

  const {externally_connectable} = manifest
  const currentIds = externally_connectable.ids || []

  // If wildcard is already present, no need to modify
  if (currentIds.includes('*')) {
    return {}
  }

  return {
    externally_connectable: {
      ...externally_connectable,
      ids: [...currentIds, '*']
    }
  }
}
