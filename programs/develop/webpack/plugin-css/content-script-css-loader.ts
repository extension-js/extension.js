import {commonStyleLoaders} from './common-style-loaders'
import {DevOptions} from '../../commands/commands-lib/config-types'

function getContentScriptFilename(index: number): string {
  return `content_scripts/content-${index}.css`
}

export async function contentScriptCssLoader(
  projectPath: string,
  mode: DevOptions['mode']
) {
  return {
    test: /\.css$/,
    type: 'asset',
    generator: {
      filename: (pathData: any) => {
        // Add contenthash to avoid naming collisions between
        // different content script CSS files
        return `styles/[name].[contenthash:8].css`
      }
    },
    // issuer: (issuer: string) => issuer.includes('content'),
    use: await commonStyleLoaders(projectPath, {
      mode: mode as 'development' | 'production'
    })
  }
}
