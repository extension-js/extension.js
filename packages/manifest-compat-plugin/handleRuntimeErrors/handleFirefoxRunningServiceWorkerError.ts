import webpack from 'webpack'
import {bgWhite, red, blue, bold, yellow, underline} from '@colors/colors'
import {type ManifestBase} from '../manifest-types'

export default function handleFirefoxRunningServiceWorkerError(
  manifest: ManifestBase,
  browser: string
): webpack.WebpackError | null {
  if (browser === 'firefox') {
    if (manifest.background.service_worker) {
      return new webpack.WebpackError(
        `${bgWhite(red(bold(` firefox-browser `)))} ${yellow(`►►►`)} ` +
          `Firefox does not support the ${yellow('background.service_worker')} field yet.\n` +
          `See ${blue(underline('https://bugzilla.mozilla.org/show_bug.cgi?id=1573659'))}.\n\n` +
          `Update your ${yellow('manifest.json')} file to use ${yellow('background.scripts')} instead.`
      )
    }
  }

  return null
}
