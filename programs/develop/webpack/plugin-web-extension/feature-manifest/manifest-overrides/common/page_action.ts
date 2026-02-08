// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import {getFilename} from '../../manifest-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'
import {type Manifest} from '../../../../webpack-types'

export function pageAction(manifest: Manifest) {
  return (
    manifest.page_action && {
      page_action: {
        ...manifest.page_action,
        ...(manifest.page_action.default_popup && {
          default_popup: getFilename(
            'action/index.html',
            manifest.page_action.default_popup as string
          )
        }),
        ...(manifest.page_action.default_icon && {
          default_icon:
            typeof manifest.page_action.default_icon === 'string'
              ? (() => {
                  const raw = String(manifest.page_action.default_icon)
                  const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
                  const target = isPublic
                    ? normalizeManifestOutputPath(raw)
                    : `icons/${path.basename(raw)}`
                  return getFilename(target, raw)
                })()
              : Object.fromEntries(
                  Object.entries(
                    manifest.page_action.default_icon as Record<string, string>
                  ).map(([size, icon]) => {
                    const raw = String(icon)
                    const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
                    const target = isPublic
                      ? normalizeManifestOutputPath(raw)
                      : `icons/${path.basename(raw)}`
                    return [size, getFilename(target, raw)]
                  })
                )
        })
      }
    }
  )
}
