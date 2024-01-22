// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {ClientConfiguration} from 'webpack-dev-server'

const authorMode = process.env.EXTENSION_ENV === 'development'

export function getWebpackStats() {
  if (!authorMode) {
    return 'minimal'
  }

  return {
    children: true,
    errorDetails: true,
    entrypoints: true,
    colors: true,
    assets: true,
    chunks: true,
    modules: true
  }
}

export function getDevServerClientOptions(): ClientConfiguration {
  if (!authorMode) {
    return {
      logging: 'none',
      progress: false,
      overlay: {
        errors: true,
        warnings: false
      }
    }
  }

  return {
    // Allows to set log level in the browser, e.g. before reloading,
    // before an error or when Hot Module Replacement is enabled.
    logging: 'error',
    // Prints compilation progress in percentage in the browser.
    progress: true,
    // Shows a full-screen overlay in the browser
    // when there are compiler errors or warnings.
    overlay: {
      errors: true,
      warnings: false
    }
  }
}
