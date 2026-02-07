//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {commonStyleLoaders} from './common-style-loaders'
import {isContentScriptEntry} from './css-lib/is-content-script'
import {createSassLoaderOptions} from './css-tools/sass'
import type {DevOptions} from '../webpack-types'

interface PreprocessorUsage {
  useSass?: boolean
  useLess?: boolean
}

export async function cssInContentScriptLoader(
  projectPath: string,
  manifestPath: string,
  mode: DevOptions['mode'],
  usage: PreprocessorUsage = {}
) {
  const {useSass = true, useLess = true} = usage
  const isContentScript = (issuer: string) =>
    isContentScriptEntry(issuer, manifestPath, projectPath)

  // Define file type configurations
  const fileTypes = [
    {test: /\.css$/, loader: null},
    ...(useSass
      ? [
          {
            test: /\.(sass|scss)$/,
            exclude: /\.module\.(sass|scss)$/,
            loader: 'sass-loader'
          },
          {test: /\.module\.(sass|scss)$/, loader: 'sass-loader'}
        ]
      : []),
    ...(useLess
      ? [
          {test: /\.less$/, exclude: /\.module\.less$/, loader: 'less-loader'},
          {test: /\.module\.less$/, loader: 'less-loader'}
        ]
      : [])
  ]

  const rules = await Promise.all(
    fileTypes.map(async ({test, exclude, loader}) => {
      const baseConfig = {
        test,
        exclude,
        type: 'asset' as const,
        generator: {
          filename: 'content_scripts/[name].[contenthash:8].css'
        },
        issuer: isContentScript
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
          loader: require.resolve(loader),
          loaderOptions
        })
      }
    })
  )

  return rules
}
