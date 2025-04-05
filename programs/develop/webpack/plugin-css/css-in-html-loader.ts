import path from 'path'
import {commonStyleLoaders} from './common-style-loaders'
import {DevOptions} from '../../commands/commands-lib/config-types'
import {isContentScriptEntry} from './is-content-script'

export async function cssInHtmlLoader(
  projectPath: string,
  mode: DevOptions['mode']
) {
  const manifestPath = path.join(projectPath, 'manifest.json')

  return [
    {
      test: /\.css$/,
      type: 'css',
      // type: 'css' breaks content scripts so let's avoid it
      issuer: (issuer: string) => !isContentScriptEntry(issuer, manifestPath),
      use: await commonStyleLoaders(projectPath, {
        mode: mode as 'development' | 'production'
      })
    }
  ]
}
