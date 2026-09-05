import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {manifestPageOutputTarget} from '../../normalize-manifest-path'

export function sandbox(manifest: Manifest, manifestPath?: string) {
  return (
    manifest.sandbox && {
      sandbox: {
        ...manifest.sandbox,
        ...(manifest.sandbox.pages && {
          pages: manifest.sandbox.pages.map((page: string, index: number) => {
            return getFilename(
              manifestPageOutputTarget(
                page,
                `sandbox/page-${index}.html`,
                manifestPath
              ),
              page
            )
          })
        })
      }
    }
  )
}
