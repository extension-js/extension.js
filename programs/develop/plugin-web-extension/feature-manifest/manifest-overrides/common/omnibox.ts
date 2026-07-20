// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'path'
import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'

const getBasename = (filepath: string) => path.basename(filepath)

export function omnibox(manifest: Manifest) {
  const omnibox = manifest.omnibox
  return (
    omnibox && {
      omnibox: {
        ...omnibox,
        ...(omnibox.default_icon && {
          default_icon:
            typeof omnibox.default_icon === 'string'
              ? getFilename(
                  `icons/${getBasename(omnibox.default_icon)}`,
                  omnibox.default_icon
                )
              : Object.fromEntries(
                  Object.entries(omnibox.default_icon).map(([size, icon]) => {
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
