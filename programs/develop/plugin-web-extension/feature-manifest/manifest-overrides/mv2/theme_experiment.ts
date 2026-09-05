import * as path from 'node:path'
import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {manifestPageOutputTarget} from '../../normalize-manifest-path'

const getBasename = (filepath: string) => path.basename(filepath)

// Only `stylesheet` is a Firefox key. A `stylesheets` list is not part of
// theme_experiment, so it passes through untouched rather than earning a
// promise nothing emits.
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
        })
      }
    }
  )
}
