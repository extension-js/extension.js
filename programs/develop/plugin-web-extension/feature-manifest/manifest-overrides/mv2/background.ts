// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {getFilename} from '../../../shared/paths'
import {type Manifest} from '../../../../types'

export function background(manifest: Manifest) {
  return (
    manifest.background &&
    manifest.background.scripts && {
      background: {
        ...manifest.background,
        ...(manifest.background.scripts && {
          // All MV2 `background.scripts` are bundled into a single emitted file, so
          // the output must reference it once — dedupe instead of repeating the same
          // bundle path per source script.
          scripts: [
            ...new Set(
              manifest.background.scripts.map((script) =>
                getFilename('background/scripts.js', String(script))
              )
            )
          ]
        })
      }
    }
  )
}
