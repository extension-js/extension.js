// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {manifestPageOutputTarget} from '../../normalize-manifest-path'

export function sidePanel(manifest: Manifest, manifestPath?: string) {
  return (
    manifest.side_panel && {
      side_panel: {
        ...manifest.side_panel,
        ...(manifest.side_panel.default_path && {
          default_path: (() => {
            const raw = String(manifest.side_panel.default_path)
            // A panel hosted in public/ ships under its own name, so the
            // compiled slot is only right for a panel the pipeline builds.
            return getFilename(
              manifestPageOutputTarget(raw, 'sidebar/index.html', manifestPath),
              raw
            )
          })()
        })
      }
    }
  )
}
