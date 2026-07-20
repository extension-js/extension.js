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
  // Contribute ONLY the rewritten `scripts` key. The aggregate merge in
  // manifest-overrides/index.ts spreads the original `background` first, so
  // re-spreading `...manifest.background` here would clobber a sibling override's
  // rewrite when both keys are present (a manifest declaring both
  // `background.service_worker` and `background.scripts` unprefixed, the MV3
  // override's spread would reset `scripts` back to its raw path, so the emitted
  // manifest referenced a file no chunk wrote under that name; G14).
  return (
    manifest.background?.scripts && {
      background: {
        // All MV2 `background.scripts` are bundled into a single emitted file, so
        // the output must reference it once, dedupe instead of repeating the same
        // bundle path per source script.
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
