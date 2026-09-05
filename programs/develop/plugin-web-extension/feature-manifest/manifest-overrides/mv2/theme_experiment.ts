import * as path from 'node:path'
import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {manifestPageOutputTarget} from '../../normalize-manifest-path'

const getBasename = (filepath: string) => path.basename(filepath)

export function themeExperiment(manifest: Manifest, manifestPath?: string) {
  const te = manifest.theme_experiment
  return (
    te && {
      theme_experiment: {
        ...te,
        ...(typeof te.stylesheet === 'string' && {
          stylesheet: getFilename(
            manifestPageOutputTarget(
              te.stylesheet,
              `theme_experiment/${getBasename(te.stylesheet)}`,
              manifestPath
            ),
            te.stylesheet
          )
        }),
        ...(Array.isArray(te.stylesheets) && {
          stylesheets: te.stylesheets.map((s: string, i: number) =>
            getFilename(
              manifestPageOutputTarget(
                s,
                `theme_experiment/stylesheet-${i}.css`,
                manifestPath
              ),
              s
            )
          )
        })
      }
    }
  )
}
