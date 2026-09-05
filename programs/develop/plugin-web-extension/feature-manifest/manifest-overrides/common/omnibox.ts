import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {iconOutputPath} from '../../normalize-manifest-path'

export function omnibox(manifest: Manifest) {
  const omnibox = manifest.omnibox
  return (
    omnibox && {
      omnibox: {
        ...omnibox,
        ...(omnibox.default_icon && {
          // The icons emitter keeps an icon's manifest-relative location and
          // leaves public-hosted files to the copier; name what it does.
          default_icon:
            typeof omnibox.default_icon === 'string'
              ? getFilename(
                  iconOutputPath(omnibox.default_icon),
                  omnibox.default_icon
                )
              : Object.fromEntries(
                  Object.entries(omnibox.default_icon).map(([size, icon]) => {
                    return [size, getFilename(iconOutputPath(icon), icon)]
                  })
                )
        })
      }
    }
  )
}
