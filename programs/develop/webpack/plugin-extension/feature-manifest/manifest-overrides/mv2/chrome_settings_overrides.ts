import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'

export function chromeSettingsOverrides(
  manifest: Manifest,
  excludeList: FilepathList
) {
  return (
    manifest.chrome_settings_overrides && {
      chrome_settings_overrides: {
        ...(manifest.chrome_settings_overrides.homepage && {
          homepage: manifest.chrome_settings_overrides.homepage
        }),
        ...(manifest.chrome_settings_overrides.search_provider && {
          search_provider: {
            ...manifest.chrome_settings_overrides.search_provider,
            ...(manifest.chrome_settings_overrides.search_provider
              .favicon_url && {
              favicon_url: (() => {
                const fav = manifest.chrome_settings_overrides.search_provider
                  .favicon_url as string
                const isUrl = /^(?:[a-z]+:)?\/\//i.test(fav)
                return isUrl
                  ? fav
                  : getFilename(
                      `chrome_settings_overrides/${fav.split('/').pop()}`,
                      fav,
                      excludeList
                    )
              })()
            })
          }
        }),
        ...(manifest.chrome_settings_overrides.startup_pages && {
          startup_pages: manifest.chrome_settings_overrides.startup_pages.map(
            (page: string, index: number) =>
              getFilename(
                `chrome_settings_overrides/startup-${index}.html`,
                page,
                excludeList
              )
          )
        })
      }
    }
  )
}
