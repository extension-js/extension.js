// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {
  iconOutputPath,
  manifestPageOutputTarget
} from '../../normalize-manifest-path'

export function sidebarAction(manifest: Manifest, manifestPath?: string) {
  return (
    manifest.sidebar_action && {
      sidebar_action: {
        ...manifest.sidebar_action,
        ...(manifest.sidebar_action.default_panel && {
          default_panel: (() => {
            const raw = String(manifest.sidebar_action.default_panel)
            // A panel hosted in public/ ships under its own name, so the
            // compiled slot is only right for a panel the pipeline builds.
            return getFilename(
              manifestPageOutputTarget(raw, 'sidebar/index.html', manifestPath),
              raw
            )
          })()
        }),

        ...(manifest.sidebar_action.default_icon && {
          default_icon:
            typeof manifest.sidebar_action.default_icon === 'string'
              ? (() => {
                  const raw = String(manifest.sidebar_action.default_icon)
                  return getFilename(iconOutputPath(raw), raw)
                })()
              : Object.fromEntries(
                  Object.entries(
                    manifest.sidebar_action.default_icon as Record<
                      string,
                      string
                    >
                  ).map(([size, icon]) => {
                    const raw = String(icon)
                    return [size, getFilename(iconOutputPath(raw), raw)]
                  })
                )
        })
      }
    }
  )
}
