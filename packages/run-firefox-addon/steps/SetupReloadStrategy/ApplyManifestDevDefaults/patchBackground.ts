import {bgWhite, red, yellow, blue, underline, bold} from '@colors/colors/safe'
export default function patchBackground(manifest: any) {
  if (!manifest.background) {
    if (manifest.manifest_version === 2) {
      return {
        background: {
          ...manifest.background,
          scripts: ['background/script.js']
        }
      }
    }

    // If the manifest version is 3, ScriptsPlugin
    // will output a service worker script, but since
    // Firefox does not support service workers in background,
    // we need to patch the manifest to use a background script.
    if (manifest.manifest_version === 3) {
      return {
        background: {
          ...manifest.background,
          scripts: ['background/service_worker.js']
        }
      }
    }
  }

  // For user-defined service workers, warn users that Firefox
  // does not support service workers in background scripts,
  // and adapt to use a background script instead.
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1573659
  if (manifest.background.service_worker) {
    console.warn(
      `${bgWhite(red(bold(` firefox-browser `)))} ${yellow(`►►►`)} ` +
        `Firefox does not support the ${yellow(
          'background.service_worker'
        )} field yet.\n` +
        `See ${blue(
          underline('https://bugzilla.mozilla.org/show_bug.cgi?id=1573659')
        )}.\n\n` +
        'This program applies a workaround to make it run, but the service worker will not be registered.\n' +
        `Update your ${yellow('manifest.json')} file to use ${yellow(
          'background.scripts'
        )} instead.`
    )

    return {
      background: {
        ...manifest.background,
        scripts: ['background/service_worker.js']
      }
    }
  }

  return {
    background: {
      ...manifest.background
    }
  }
}
