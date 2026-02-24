//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {commonStyleLoaders} from './common-style-loaders'
import {isContentScriptEntry} from './css-lib/is-content-script'
import {createSassLoaderOptions} from './css-tools/sass'
import {resolveOptionalDependencySync} from '../webpack-lib/optional-deps-resolver'
import type {DevOptions} from '../webpack-types'

interface PreprocessorUsage {
  useSass?: boolean
  useLess?: boolean
}

function resolvePreprocessorLoader(
  loader: 'sass-loader' | 'less-loader',
  projectPath: string
): string {
  return resolveOptionalDependencySync(loader, projectPath)
}

export async function cssInHtmlLoader(
  projectPath: string,
  mode: DevOptions['mode'],
  manifestPath: string,
  usage: PreprocessorUsage = {}
) {
  const {useSass = true, useLess = true} = usage
  const isNotContentScript = (issuer: string) =>
    !isContentScriptEntry(issuer, manifestPath, projectPath)

  // Define file type configurations
  const fileTypes = [
    {test: /\.module\.css$/, type: 'css/module', loader: null},
    {test: /\.css$/, exclude: /\.module\.css$/, type: 'css', loader: null},
    ...(useSass
      ? [
          {
            test: /\.(sass|scss)$/,
            exclude: /\.module\.(sass|scss)$/,
            type: 'css',
            loader: 'sass-loader'
          },
          {
            test: /\.module\.(sass|scss)$/,
            type: 'css/module',
            loader: 'sass-loader'
          }
        ]
      : []),
    ...(useLess
      ? [
          {
            test: /\.less$/,
            exclude: /\.module\.less$/,
            type: 'css',
            loader: 'less-loader'
          },
          {
            test: /\.module\.less$/,
            type: 'css/module',
            loader: 'less-loader'
          }
        ]
      : [])
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
          ? createSassLoaderOptions(
              projectPath,
              mode as 'development' | 'production'
            )
          : {sourceMap: true}

      return {
        ...baseConfig,
        use: await commonStyleLoaders(projectPath, {
          mode: mode as 'development' | 'production',
          loader: resolvePreprocessorLoader(
            loader as 'sass-loader' | 'less-loader',
            projectPath
          ),
          loaderOptions
        })
      }
    })
  )

  return rules
}
