// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {manifestJsonOutputTarget} from '../../normalize-manifest-path'

export function storage(
  manifest: Manifest,
  manifestPath?: string,
  projectPath?: string
) {
  return (
    manifest.storage && {
      storage: {
        ...(manifest.storage.managed_schema && {
          managed_schema: (() => {
            const raw = String(manifest.storage.managed_schema)
            return getFilename(
              manifestJsonOutputTarget(
                raw,
                'storage/managed_schema.json',
                manifestPath,
                projectPath
              ),
              raw
            )
          })()
        })
      }
    }
  )
}
