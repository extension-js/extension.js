import * as path from 'path'
import {type Compiler} from '@rspack/core'
import {DevOptions} from '../../../../module'

export function SetupFirefoxReloadClient(
  compiler: Compiler,
  browser: DevOptions['browser'],
  manifestPath: string
) {
  compiler.options.module.rules.push({
    test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
    include: [path.dirname(manifestPath)],
    exclude: [/[\\/]node_modules[\\/]/],
    use: [
      {
        loader: path.resolve(__dirname, './inject-firefox-client-loader'),
        options: {
          manifestPath,
          browser
        }
      }
    ]
  })
}
