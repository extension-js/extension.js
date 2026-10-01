// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {pageActionOutputTarget} from '../../../shared/html-surfaces'
import {getFilename} from '../../../shared/paths'
import {
  iconOutputPath,
  manifestPageOutputTarget
} from '../../normalize-manifest-path'

export function pageAction(
  manifest: Manifest,
  manifestPath?: string,
  projectPath?: string
) {
  return (
    manifest.page_action && {
      page_action: {
        ...manifest.page_action,
        ...(manifest.page_action.default_popup && {
          default_popup: getFilename(
            manifestPageOutputTarget(
              String(manifest.page_action.default_popup),
              pageActionOutputTarget(manifest),
              manifestPath,
              projectPath
            ),
            String(manifest.page_action.default_popup)
          )
        }),
        ...(manifest.page_action.default_icon && {
          default_icon:
            typeof manifest.page_action.default_icon === 'string'
              ? (() => {
                  const raw = String(manifest.page_action.default_icon)

                  return getFilename(iconOutputPath(raw), raw)
                })()
              : Object.fromEntries(
                  Object.entries(
                    manifest.page_action.default_icon as Record<string, string>
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
