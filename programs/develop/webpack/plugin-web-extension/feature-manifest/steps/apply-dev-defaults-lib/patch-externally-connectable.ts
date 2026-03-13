// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {type Manifest} from '../../../../webpack-types'

export default function patchExternallyConnectable(manifest: Manifest) {
  if (manifest.externally_connectable && !manifest.externally_connectable.ids) {
    return {
      externally_connectable: {
        ...manifest.externally_connectable,
        ids: [...new Set(manifest.externally_connectable.ids || []), '*']
      }
    }
  }

  if (manifest.externally_connectable && !manifest.externally_connectable.ids) {
    return {
      externally_connectable: {
        ...manifest.externally_connectable,
        ids: ['*']
      }
    }
  }

  return {}
}
