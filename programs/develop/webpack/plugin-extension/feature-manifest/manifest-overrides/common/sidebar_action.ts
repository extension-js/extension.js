import * as path from 'path'
import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'

export function sidebarAction(manifest: Manifest) {
  return (
    manifest.sidebar_action && {
      sidebar_action: {
        ...manifest.sidebar_action,
        ...(manifest.sidebar_action.default_panel && {
          default_panel: getFilename(
            `sidebar/index.html`,
            manifest.sidebar_action.default_panel as string
          )
        }),

        ...(manifest.sidebar_action.default_icon && {
          default_icon:
            typeof manifest.sidebar_action.default_icon === 'string'
              ? (() => {
                  const raw = String(manifest.sidebar_action.default_icon)
                  const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
                  const target = isPublic
                    ? normalizeManifestOutputPath(raw)
                    : `icons/${path.basename(raw)}`
                  return getFilename(target, raw)
                })()
              : Object.fromEntries(
                  Object.entries(
                    manifest.sidebar_action.default_icon as Record<
                      string,
                      string
                    >
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
