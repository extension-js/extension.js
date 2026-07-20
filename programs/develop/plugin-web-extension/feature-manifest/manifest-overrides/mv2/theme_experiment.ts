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

// Firefox-only: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/theme_experiment
export function themeExperiment(manifest: Manifest) {
  const te = manifest.theme_experiment
  return (
    te && {
      theme_experiment: {
        ...te,
        ...(typeof te.stylesheet === 'string' && {
          stylesheet: getFilename(
            `theme_experiment/${getBasename(te.stylesheet)}`,
            te.stylesheet
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
