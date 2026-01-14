// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import {getFilename} from '../../manifest-lib/paths'
import {type Manifest} from '../../../../webpack-types'

const getBasename = (filepath: string) => path.basename(filepath)

// Firefox-only: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/theme_experiment
export function themeExperiment(manifest: Manifest) {
  const te: any = (manifest as any).theme_experiment
  return (
    te && {
      theme_experiment: {
        ...te,
        ...(te.stylesheet && {
          stylesheet: getFilename(
            `theme_experiment/${getBasename(te.stylesheet as string)}`,
            te.stylesheet as string
          )
        }),
        ...(Array.isArray(te.stylesheets) && {
          stylesheets: te.stylesheets.map((s: string, i: number) =>
            getFilename(`theme_experiment/stylesheet-${i}.css`, s)
          )
        })
      }
    }
  )
}
