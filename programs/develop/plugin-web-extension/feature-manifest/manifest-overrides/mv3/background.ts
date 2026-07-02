// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {getFilename} from '../../../shared/paths'
import {type Manifest} from '../../../../types'

export function backgroundServiceWorker(manifest: Manifest) {
  // Contribute ONLY the rewritten `service_worker` key — see the sibling MV2
  // override for why re-spreading `...manifest.background` here clobbers other
  // keys in the aggregate merge (G14).
  return (
    manifest.background &&
    manifest.background.service_worker && {
      background: {
        service_worker: (() => {
          const raw = String(manifest.background.service_worker)
          return getFilename('background/service_worker.js', raw)
        })()
      }
    }
  )
}
