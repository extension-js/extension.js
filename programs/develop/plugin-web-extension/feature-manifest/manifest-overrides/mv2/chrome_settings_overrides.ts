import * as path from 'node:path'
import type {Manifest} from '../../../../types'
import {getFilename, isManifestAddress} from '../../../shared/paths'
import {manifestPageOutputTarget} from '../../normalize-manifest-path'

export function chromeSettingsOverrides(
  manifest: Manifest,
  manifestPath?: string
) {
  const overrides = manifest.chrome_settings_overrides
  return (
    overrides && {
      chrome_settings_overrides: {
        ...(overrides.homepage && {homepage: overrides.homepage}),
        ...(overrides.search_provider && {
          search_provider: {
            ...overrides.search_provider,
            ...(overrides.search_provider.favicon_url && {
              // A remote favicon is an address; a packaged one ships through
              // the icons emitter at the path named here.
              favicon_url: (() => {
                const fav = String(overrides.search_provider.favicon_url)
                if (isManifestAddress(fav)) return fav
                return getFilename(
                  manifestPageOutputTarget(
                    fav,
                    `chrome_settings_overrides/${path.basename(fav)}`,
                    manifestPath
                  ),
                  fav
                )
              })()
            })
          }
        }),
        ...(overrides.startup_pages && {
          // Startup pages are usually web addresses, which survive verbatim;
          // a packaged html page compiles to the path named here.
          startup_pages: overrides.startup_pages.map(
            (page: string, index: number) =>
              isManifestAddress(page)
                ? page
                : getFilename(
                    manifestPageOutputTarget(
                      page,
                      `chrome_settings_overrides/startup-${index}.html`,
                      manifestPath
                    ),
                    page
                  )
          )
        })
      }
    }
  )
}
