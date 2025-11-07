import {commonStyleLoaders} from './common-style-loaders'
import {DevOptions} from '../types/options'
import {isContentScriptEntry} from './css-lib/is-content-script'

export async function cssInHtmlLoader(
  projectPath: string,
  mode: DevOptions['mode'],
  manifestPath: string
) {
  const isNotContentScript = (issuer: string) =>
    !isContentScriptEntry(issuer, manifestPath)

  // Define file type configurations
  const fileTypes = [
    {test: /\.css$/, type: 'css', loader: null},
    {
      test: /\.(sass|scss)$/,
      exclude: /\.module\.(sass|scss)$/,
      type: 'css',
      loader: 'sass-loader'
    },
    {test: /\.module\.(sass|scss)$/, type: 'css/module', loader: 'sass-loader'},
    {
      test: /\.less$/,
      exclude: /\.module\.less$/,
      type: 'css',
      loader: 'less-loader'
    },
    {test: /\.module\.less$/, type: 'css/module', loader: 'less-loader'}
  ]

  const rules = await Promise.all(
    fileTypes.map(async ({test, exclude, type, loader}) => {
      const baseConfig = {
        test,
        exclude,
        type,
        issuer: isNotContentScript
      }

      if (!loader) {
        // Regular CSS - no preprocessor needed
        return {
          ...baseConfig,
          use: await commonStyleLoaders(projectPath, {
            mode: mode as 'development' | 'production'
          })
        }
      }

      // Preprocessor CSS
      const loaderOptions =
        loader === 'sass-loader'
          ? {sourceMap: true, sassOptions: {outputStyle: 'expanded'}}
          : {sourceMap: true}

      return {
        ...baseConfig,
        use: await commonStyleLoaders(projectPath, {
          mode: mode as 'development' | 'production',
          loader: require.resolve(loader),
          loaderOptions
        })
      }
    })
  )

  return rules
}
