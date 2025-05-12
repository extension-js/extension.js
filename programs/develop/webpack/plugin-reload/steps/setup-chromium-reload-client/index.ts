import * as path from 'path'
import {type Compiler} from '@rspack/core'
import {getDirname} from '../../../../dirname'
import {DevOptions} from '../../../../commands/commands-lib/config-types'

const __dirname = getDirname(import.meta.url)

export function SetupChromiumReloadClient(
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
        loader: path.resolve(__dirname, './inject-chromium-client-loader'),
        options: {
          manifestPath,
          browser
        }
      }
    ]
  })
}
