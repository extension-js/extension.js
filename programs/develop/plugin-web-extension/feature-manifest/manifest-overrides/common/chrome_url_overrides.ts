// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {manifestPageOutputTarget} from '../../normalize-manifest-path'

export function chromeUrlOverrides(manifest: Manifest, manifestPath?: string) {
  return (
    manifest.chrome_url_overrides && {
      chrome_url_overrides: {
        ...(manifest.chrome_url_overrides.bookmarks && {
          bookmarks: (() => {
            const raw = String(manifest.chrome_url_overrides.bookmarks)
            return getFilename(
              manifestPageOutputTarget(
                raw,
                'chrome_url_overrides/bookmarks.html',
                manifestPath
              ),
              raw
            )
          })()
        }),
        ...(manifest.chrome_url_overrides.history && {
          history: (() => {
            const raw = String(manifest.chrome_url_overrides.history)
            return getFilename(
              manifestPageOutputTarget(
                raw,
                'chrome_url_overrides/history.html',
                manifestPath
              ),
              raw
            )
          })()
        }),
        ...(manifest.chrome_url_overrides.newtab && {
          newtab: (() => {
            const raw = String(manifest.chrome_url_overrides.newtab)
            return getFilename(
              manifestPageOutputTarget(
                raw,
                'chrome_url_overrides/newtab.html',
                manifestPath
              ),
              raw
            )
          })()
        })
      }
    }
  )
}
