import * as path from 'path'
import {commonStyleLoaders} from './common-style-loaders'
import {DevOptions} from '../../commands/commands-lib/config-types'
import {isContentScriptEntry} from './is-content-script'

export async function cssInContentScriptLoader(
  projectPath: string,
  mode: DevOptions['mode']
) {
  const manifestPath = path.join(projectPath, 'manifest.json')

  return [
    {
      test: /\.css$/,
      type: 'asset',
      generator: {
        // Add contenthash to avoid naming collisions between
        // different content script CSS files
        filename: 'content_scripts/[name].[contenthash:8].css'
      },
      issuer: (issuer: string) => isContentScriptEntry(issuer, manifestPath),
      use: await commonStyleLoaders(projectPath, {
        mode: mode as 'development' | 'production'
      })
    }
  ]
}
