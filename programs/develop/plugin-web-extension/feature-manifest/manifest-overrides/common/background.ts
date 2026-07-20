// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'

export function backgroundPage(manifest: Manifest) {
  // Contribute ONLY the rewritten `page` key, see the sibling MV2 override for
  // why re-spreading `...manifest.background` here clobbers other keys in the
  // aggregate merge (G14).
  return (
    manifest.background?.page && {
      background: {
        page: (() => {
          const raw = String(manifest.background.page)
          return getFilename('background/index.html', raw)
        })()
      }
    }
  )
}
