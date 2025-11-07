import * as path from 'path'
import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'

export function action(manifest: Manifest) {
  return (
    manifest.action && {
      action: {
        ...manifest.action,
        ...(manifest.action.default_popup && {
          default_popup: getFilename(
            `action/index.html`,
            manifest.action.default_popup as string
          )
        }),

        ...(manifest.action.default_icon && {
          default_icon:
            typeof manifest.action.default_icon === 'string'
              ? (() => {
                  const raw = String(manifest.action.default_icon)
                  const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
                  const target = isPublic
                    ? normalizeManifestOutputPath(raw)
                    : `icons/${path.basename(raw)}`
                  return getFilename(target, raw)
                })()
              : Object.fromEntries(
                  Object.entries(
                    manifest.action.default_icon as Record<string, string>
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
