import * as path from 'path'
import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../manifest-lib/paths'

const getBasename = (filepath: string) => path.basename(filepath)

export function omnibox(manifest: Manifest) {
  return (
    (manifest as any).omnibox && {
      omnibox: {
        ...(manifest as any).omnibox,
        ...(((manifest as any).omnibox as any).default_icon && {
          default_icon:
            typeof ((manifest as any).omnibox as any).default_icon === 'string'
              ? getFilename(
                  `icons/${getBasename(
                    ((manifest as any).omnibox as any).default_icon as string
                  )}`,
                  ((manifest as any).omnibox as any).default_icon as string
                )
              : Object.fromEntries(
                  Object.entries(
                    ((manifest as any).omnibox as any).default_icon as Record<
                      string,
                      string
                    >
                  ).map(([size, icon]) => {
                    return [
                      size,
                      getFilename(`icons/${getBasename(icon)}`, icon)
                    ]
                  })
                )
        })
      }
    }
  )
}
