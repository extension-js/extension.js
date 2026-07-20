// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'

export function background(manifest: Manifest) {
  // Contribute ONLY the rewritten `scripts` key: re-spreading manifest.background
  // here would clobber a sibling override's rewrite when both keys are present.
  return (
    manifest.background?.scripts && {
      background: {
        // All MV2 `background.scripts` bundle into a single emitted file, so
        // dedupe instead of repeating the same bundle path per source script.
        scripts: [
          ...new Set(
            manifest.background.scripts.map((script) =>
              getFilename('background/scripts.js', String(script))
            )
          )
        ]
      }
    }
  )
}
